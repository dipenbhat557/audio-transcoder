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

        const transcript = await openai.audio.transcriptions.create({
          file: audioFile,
          model: 'whisper-1',
          response_format: 'verbose_json',
        });

        if (transcript.segments && transcript.segments.length > 0) {
          const segments = this.processTranscriptSegments(transcript.segments);
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

      const transcript = await openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        response_format: 'verbose_json',
      });

      const segments = this.processTranscriptSegments(transcript.segments);
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

  processTranscriptSegments(segments) {
    return segments.map((segment, index) => {
      const speaker = segment.start_time - (segments[index - 1]?.end_time || 0) > 0.5 
        ? (index % 2 === 0 ? 'Speaker A' : 'Speaker B')
        : (index % 2 === 0 ? 'Speaker B' : 'Speaker A');

      return {
        speaker,
        text: segment.text,
        start: segment.start_time,
        end: segment.end_time,
      };
    });
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
