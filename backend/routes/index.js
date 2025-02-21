const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const multer = require('multer');

dotenv.config();

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for audio file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir)
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname)
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['audio/flac', 'audio/mp3', 'audio/mp4', 'audio/mpeg', 
                         'audio/mpga', 'audio/m4a', 'audio/ogg', 'audio/wav', 'audio/webm'];
    // Also check file extension since MIME types might not be reliable
    const fileExtension = path.extname(file.originalname).toLowerCase();
    const validExtensions = ['.flac', '.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.ogg', '.wav', '.webm'];
    
    if (allowedTypes.includes(file.mimetype) || validExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Supported formats: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm'));
    }
  }
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Helper function to detect speaker changes
function detectSpeakerChanges(segments) {
  return segments.map((segment, index) => {
    // First segment is always Speaker A
    if (index === 0) return { ...segment, speaker: 'Speaker A' };

    const prevSegment = segments[index - 1];
    const timeGap = segment.start - prevSegment.end;
    const prevSpeaker = prevSegment.speaker;

    // Change speaker if there's a significant pause (> 1 second)
    // or if there's a clear discourse marker
    const discourseMarkers = ['but', 'well', 'so', 'okay', 'right', 'um', 'uh'];
    const startsWithMarker = discourseMarkers.some(marker => 
      segment.text.toLowerCase().trim().startsWith(marker)
    );

    const shouldChangeSpeaker = timeGap > 1.0 || startsWithMarker;
    const speaker = shouldChangeSpeaker ? 
      (prevSpeaker === 'Speaker A' ? 'Speaker B' : 'Speaker A') : 
      prevSpeaker;

    return { ...segment, speaker };
  });
}

router.get('/', (req, res) => {
  res.send('Hello World!');
});

router.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    console.log('Uploaded file:', req.file);

    const openAIFile = await OpenAI.toFile(
      fs.createReadStream("D:/FullStack/recording-transcoder/backend/tests_assets_test.mp3"),
      "tests_assets_test.mp3"
    );

    // First get the transcription
    const transcript = await openai.audio.transcriptions.create({
      file: openAIFile,
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment', 'word'],
      temperature: 0.2,
      language: 'en'
    });

    // Then use completions API to analyze the conversation
    const completion = await openai.completions.create({
      model: "gpt-3.5-turbo-instruct",
      prompt: `Analyze this conversation transcript and identify different speakers. Format your response as JSON with speaker assignments.
      
Transcript segments:
${JSON.stringify(transcript.segments, null, 2)}

Return a JSON object with a 'segments' array where each segment has:
- speaker: "Speaker A" or "Speaker B"
- text: (original text)
- start: (start time)
- end: (end time)`,
      max_tokens: 2000,
      temperature: 0.3,
      top_p: 0.8,
      frequency_penalty: 0.5,
      presence_penalty: 0.5,
      stop: ["```"],  // Stop at code blocks
      n: 1,  // Generate one completion
    });

    let speakerSegments;
    try {
      // Extract the JSON from the completion text
      const jsonMatch = completion.choices[0].text.match(/\{[\s\S]*\}/);
      const gptAnalysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      speakerSegments = gptAnalysis?.segments;
    } catch (e) {
      console.error('Failed to parse GPT analysis, falling back to simple detection:', e);
      // Fallback to our simple speaker detection if GPT analysis fails
      speakerSegments = detectSpeakerChanges(transcript.segments);
    }

    // Process and format the final segments
    const formattedSegments = speakerSegments.map(segment => ({
      speaker: segment.speaker || 'Unknown Speaker',
      text: segment.text,
      start: segment.start,
      end: segment.end,
      words: segment.words || [],
      confidence: segment.confidence
    }));

    res.json({
      success: true,
      transcript: formattedSegments
    });

  } catch (error) {
    console.error('Error processing audio:', error);
    res.status(500).send({ 
      error: 'Failed to process audio file',
      details: error.message 
    });
  }
});


router.post('/embed', async (req, res) => {
  const { question } = req.body;
  try {
    const embeddingResponse = await openai.embeddings.create({
      input: question,
      model: 'text-embedding-ada-002'
    });
    res.json({ embedding: embeddingResponse.data[0].embedding });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/query', async (req, res) => {
  const { vector } = req.body;
  try {
    const index = pc.Index(indexName);
    const queryResponse = await index.query({
      vector,
      top_k: 5, // Number of results to return
      include_metadata: true
    });
    res.json({ results: queryResponse.matches });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware for multer errors
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error: 'File upload error',
      details: error.message
    });
  } else if (error) {
    return res.status(400).json({
      error: 'Invalid file type',
      details: error.message
    });
  }
  next();
});


module.exports = router;
