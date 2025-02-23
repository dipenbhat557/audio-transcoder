const { pc, indexName, openai } = require("../config");
const { Router } = require("express");

const router = Router();

router.post("/query", async (req, res) => {
    const { question, namespace, questionHistory } = req.body;

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

        console.log("queryResponse", queryResponse.matches[0].metadata);
        const summaries = queryResponse.matches
            .filter(match => match.metadata.type === 'summary')
            .map(match => match.metadata.summary);
            
        const segments = queryResponse.matches
            .filter(match => match.metadata.type === 'segment')
            .map(match => ({
                speaker: match.metadata.speaker,
                text: match.metadata.text,
                start: match.metadata.start || 0
            }))
            .sort((a, b) => a.start - b.start);

        const combinedSummary = summaries.join('\n\n');

        const prompt = `You are an AI assistant analyzing a specific conversation. Your task is to answer questions about this conversation accurately and precisely, using the provided context and previous question history.

Context from the conversation:
${segments.map(s => `${s.speaker}: ${s.text}`).join('\n')}

Summary of the conversation:
${combinedSummary || 'No summary available.'}

Previous question history:
${questionHistory.map(q => `${q.question}: ${q.answer}`).join('\n')}

Question: ${question}

Instructions:
1. Answer ONLY based on the information provided in the conversation and summary above.
2. Be specific and cite the relevant parts of the conversation in your answer, including speaker names.
3. If speaker names are not provided, use the summary and conversation context to determine the speaker.
4. If multiple speakers discussed the topic, include their perspectives.
5. Maintain the context of who said what by referencing the speakers.
6. If the question relates to previous interactions, consider those in your answer.

Please provide your answer:`;

        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "system",
                    content: "You are a precise and accurate AI assistant that helps answer questions about specific conversations. You must use the provided conversation context and summary to answer questions. Never make assumptions or include information not present in the context."
                },
                { role: "user", content: prompt }
            ],
            temperature: 0.9, // Lower temperature for more focused responses
            max_tokens: 500  // Increased token limit for more detailed responses
        });

        console.log("completion", completion.choices[0].message);

        const answer = completion.choices[0].message.content;
        res.json({ 
            answer,
            context: {
                segments: segments.length,
                summaries: summaries.length
            }
        });
    } catch (error) {
        console.error("Error processing query:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;