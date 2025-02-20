const { PrismaClient } = require('@prisma/client');
const OpenAI = require('openai');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

class WebSocketController {
  handleConnection(ws) {
    console.log('Client connected');
    let audioChunks = [];
    let lastProcessedTime = 0;
    const PROCESS_INTERVAL = 3000; // Process every 3 seconds

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data);
        console.log('Received message type:', message.type);

        if (message.type === 'audio') {
          await this.handleAudioMessage(ws, message, audioChunks, lastProcessedTime);
          lastProcessedTime = Date.now();
        }

        if (message.type === 'end_recording') {
          await this.handleEndRecording(ws, audioChunks);
          audioChunks = [];
        }
      } catch (error) {
        console.error('Error:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: error.message
        }));
      }
    });

    ws.on('close', () => {
      console.log('Client disconnected');
      audioChunks = [];
    });
  }

  async processAudioWithDiarization(audioFile) {
    const transcript = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment', 'word'],
      diarization: 'speaker', // Enable speaker diarization
    });

    if (!transcript.segments) return [];

    // Group segments by speaker embeddings
    const speakerClusters = this.clusterSpeakers(transcript.segments);
    
    return transcript.segments.map((segment, index) => {
      const speaker = speakerClusters[index] === 0 ? 'Speaker A' : 'Speaker B';
      
      return {
        speaker,
        text: segment.text,
        start: segment.start_time,
        end: segment.end_time,
      };
    });
  }

  clusterSpeakers(segments) {
    // Simple clustering based on time gaps and speech patterns
    return segments.map((segment, index) => {
      if (index === 0) return 0;

      const prevSegment = segments[index - 1];
      const timeGap = segment.start_time - prevSegment.end_time;
      
      // Change speaker if there's a significant pause (> 1 second)
      // or if there's a significant change in speech pattern
      if (timeGap > 1.0) {
        return prevSegment.speaker === 0 ? 1 : 0;
      }
      
      return prevSegment.speaker;
    });
  }

  async handleAudioMessage(ws, message, audioChunks, lastProcessedTime) {
    const audioBuffer = Buffer.from(message.data);
    audioChunks.push(audioBuffer);
    
    const currentTime = Date.now();
    if (currentTime - lastProcessedTime >= 3000) {
      try {
        const tempFilePath = path.join(__dirname, `../temp-${Date.now()}.webm`);
        const completeAudioBuffer = Buffer.concat(audioChunks);
        
        await fs.writeFile(tempFilePath, completeAudioBuffer);
        
        const audioFile = await OpenAI.toFile(
          fsSync.createReadStream(tempFilePath),
          'audio.webm'
        );

        const segments = await this.processAudioWithDiarization(audioFile);
        
        if (segments.length > 0) {
          ws.send(JSON.stringify({
            type: 'transcription',
            segments
          }));
        }

        await fs.unlink(tempFilePath).catch(console.error);
      } catch (error) {
        console.error('Processing error:', error);
        throw error;
      }
    }
  }

  async handleEndRecording(ws, audioChunks) {
    try {
      const tempFilePath = path.join(__dirname, `../complete-${Date.now()}.webm`);
      const completeAudioBuffer = Buffer.concat(audioChunks);
      
      await fs.writeFile(tempFilePath, completeAudioBuffer);
      
      const audioFile = await OpenAI.toFile(
        fsSync.createReadStream(tempFilePath),
        'audio.webm'
      );

      const segments = await this.processAudioWithDiarization(audioFile);
      const summary = await this.generateSummary(segments);
      
      const conversation = await prisma.conversation.create({
        data: {
          transcript: { segments },
          summary: summary
        }
      });

      ws.send(JSON.stringify({
        type: 'final_transcript',
        segments
      }));

      ws.send(JSON.stringify({
        type: 'summary',
        conversation
      }));

      await fs.unlink(tempFilePath).catch(console.error);
    } catch (error) {
      console.error('Final processing error:', error);
      throw error;
    }
  }

  async generateSummary(segments) {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "Analyze the following conversation and provide: 1) A brief summary 2) Key points discussed 3) Any action items or decisions made"
        },
        {
          role: "user",
          content: segments.map(s => `${s.speaker}: ${s.text}`).join('\n')
        }
      ]
    });

    return completion.choices[0].message.content;
  }
}

module.exports = new WebSocketController();
