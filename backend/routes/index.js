const { pc, indexName, openai } = require("../config");
const { Router } = require("express");

const router = Router();

router.post("/query", async (req, res) => {
    const { question, namespace } = req.body;

    const embeddingResponse = await openai.embeddings.create({
        input: question,
        model: "text-embedding-ada-002",
    });

    const vector = embeddingResponse.data[0].embedding;

    try {
        const index = pc.index(indexName);
        const queryResponse = await index.namespace(namespace).query({
            vector,
            topK: 10,
            includeValues: false,
            includeMetadata: true,
            filter: { $or: [{ type: "segment" }, { type: "summary" }] }
        });

        const summaries = queryResponse.matches
            .filter(match => match.metadata.type === 'summary')
            .map(match => match.metadata.summary);
            
        const segments = queryResponse.matches
            .filter(match => match.metadata.type === 'segment')
            .map(match => ({
                speaker: match.metadata.speaker,
                text: match.metadata.text
            }))
            .sort((a, b) => a.start - b.start);

        const prompt = `You are a helpful AI assistant answering questions about a specific conversation. 
Answer the question based on the following context. If the answer cannot be found in the context, say "I cannot answer this based on the conversation content."

Context from the conversation:
${segments.map(s => `${s.speaker}: ${s.text}`).join('\n')}

Summary of the conversation:
${summaries[0] || 'No summary available.'}

User's question: ${question}

Please provide a specific answer based only on the information provided in the conversation above.`;

        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "system",
                    content: "You are an AI assistant that helps answer questions about specific conversations. Only answer based on the provided conversation context. If the information isn't in the context, say so."
                },
                { role: "user", content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 300
        });

        const answer = completion.choices[0].message.content;
        res.json({ answer });
    } catch (error) {
        console.error("Error processing query:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;