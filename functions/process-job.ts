
import { createClient } from 'https://esm.sh/@insforge/sdk@latest';

export default async function (req: Request): Promise<Response> {
    // CORS headers
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
        // 1. Initialize InsForge Client
        const client = createClient({
            baseUrl: Deno.env.get('INSFORGE_BASE_URL') ?? '',
            anonKey: Deno.env.get('INSFORGE_ANON_KEY') ?? '',
        });

        // Parse request
        const { jobId } = await req.json();

        if (!jobId) {
            return new Response(JSON.stringify({ error: 'Missing jobId' }), { status: 400, headers: corsHeaders });
        }

        // 2. Fetch Job Details
        const { data: job, error: jobError } = await client.database
            .from('jobs')
            .select('*')
            .eq('id', jobId)
            .single();

        if (jobError || !job) {
            return new Response(JSON.stringify({ error: 'Job not found' }), { status: 404, headers: corsHeaders });
        }

        if (job.status === 'stopped' || job.status === 'completed' || job.status === 'failed') {
            return new Response(JSON.stringify({ message: `Job is ${job.status}, stopping.` }), { status: 200, headers: corsHeaders });
        }

        // Update status to running if pending
        if (job.status === 'pending') {
            await client.database.from('jobs').update({ status: 'running' }).eq('id', jobId);
        }

        // 3. Fetch Pending Rows (Batch of 20)
        const { data: rows, error: rowsError } = await client.database
            .from('job_rows')
            .select('*')
            .eq('job_id', jobId)
            .eq('status', 'pending')
            .order('row_index', { ascending: true })
            .limit(20);

        if (rowsError) {
            throw new Error(`Failed to fetch rows: ${rowsError.message}`);
        }

        if (!rows || rows.length === 0) {
            // No more rows, mark job as completed
            await client.database.from('jobs').update({ status: 'completed', end_time: new Date() }).eq('id', jobId);
            return new Response(JSON.stringify({ message: 'Job completed' }), { status: 200, headers: corsHeaders });
        }

        // 4. Process Rows
        const mapping = job.mapping;
        let sentCount = 0;
        let failedCount = 0;

        for (const row of rows) {
            // Check if job was stopped concurrently
            const { data: currentJob } = await client.database.from('jobs').select('status').eq('id', jobId).single();
            if (currentJob?.status === 'stopped') {
                break;
            }

            const rowData = row.data;
            const caption = `
<b>${rowData[mapping.title] || "No Title"}</b>

${rowData[mapping.description] || ""}

🔗 <a href="${rowData[mapping.view] || "#"}">View</a>
⬇️ <a href="${rowData[mapping.download] || "#"}">Download</a>
      `.trim();

            const imageUrl = rowData[mapping.image];

            try {
                if (!imageUrl) throw new Error("No image URL");

                // Send to Telegram
                const tgRes = await fetch(`https://api.telegram.org/bot${job.bot_token}/sendPhoto`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: job.channel_id,
                        photo: imageUrl,
                        caption: caption,
                        parse_mode: 'HTML'
                    })
                });

                const tgData = await tgRes.json();

                if (tgData.ok) {
                    // Success
                    await client.database.from('job_rows').update({ status: 'sent' }).eq('id', row.id);
                    sentCount++;
                } else if (tgData.error_code === 429) {
                    // Rate limit
                    const retryAfter = tgData.parameters?.retry_after || 30;
                    await new Promise(r => setTimeout(r, retryAfter * 1000));

                    await client.database.from('job_rows').update({ status: 'pending' }).eq('id', row.id); // Leave as pending to retry
                    // Wait to respect rate limit
                    await new Promise(r => setTimeout(r, retryAfter * 1000));
                } else {
                    throw new Error(tgData.description || "Telegram Error");
                }
            } catch (err: any) {
                failedCount++;
                await client.database.from('job_rows').update({
                    status: 'failed',
                    error: err.message
                }).eq('id', row.id);
            }

            // Small delay between messages
            await new Promise(r => setTimeout(r, 2000));
        }

        // 5. Update Job Stats
        // Use manual update instead of RPC to avoid dependency on SQL function existence, 
        // or assuming RPC needs client.database.rpc if it existed.
        const { data: latestJob } = await client.database.from('jobs').select('sent, failed, current').eq('id', jobId).single();
        if (latestJob) {
            await client.database.from('jobs').update({
                sent: latestJob.sent + sentCount,
                failed: latestJob.failed + failedCount,
                current: latestJob.current + sentCount + failedCount,
                updated_at: new Date()
            }).eq('id', jobId);
        }

        // 6. Chain Invocation (Recursive) if more rows exist
        const { count } = await client.database
            .from('job_rows')
            .select('*', { count: 'exact', head: true })
            .eq('job_id', jobId)
            .eq('status', 'pending');

        if (count && count > 0) {
            // Invoke self asynchronously 
            fetch(`${Deno.env.get('INSFORGE_FUNCTION_URL')}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': req.headers.get('Authorization') || ''
                },
                body: JSON.stringify({ jobId })
            }).catch(e => console.error("Failed to chain", e));

            return new Response(JSON.stringify({
                message: `Processed ${sentCount + failedCount} rows. Triggering next batch.`,
                continue: true
            }), { status: 200, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ message: "Job completed" }), { status: 200, headers: corsHeaders });

    } catch (err: any) {
        console.error("Function error:", err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
}
