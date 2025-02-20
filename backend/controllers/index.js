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
  constructor() {
    this.transcriptionHistory = new Map();
    this.lastTranscripts = new Map(); 
  }

  handleConnection(ws) {
    console.log('Client connected');
    let audioChunks = [];
    let lastProcessedTime = 0;
    this.transcriptionHistory.set(ws, []);
    this.lastTranscripts.set(ws, ''); 

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data);
        console.log('Received message type:', message.type);

        if (message.type === 'audio') {
          lastProcessedTime = await this.handleAudioMessage(ws, message, audioChunks, lastProcessedTime);
        }

        if (message.type === 'end_recording') {
          await this.handleEndRecording(ws, audioChunks);
          audioChunks = [];
          this.lastTranscripts.delete(ws);
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
      this.transcriptionHistory.delete(ws);
      this.lastTranscripts.delete(ws);
    });
  }

  async processAudioWithDiarization(audioFile) {
    const transcript = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment', 'word'],
      temperature: 0.2,
      language: 'en'
    });

    if (!transcript.segments) return [];

    const BATCH_SIZE = 3; 
    const processedSegments = [];
    
    for (let i = 0; i < transcript.segments.length; i += BATCH_SIZE) {
      const batch = transcript.segments.slice(i, i + BATCH_SIZE);
      
      try {
        const completion = await openai.completions.create({
          model: "gpt-3.5-turbo-instruct",
          prompt: `Analyze these conversation segments and assign speakers.
Previous speaker: ${i > 0 ? processedSegments[i-1]?.speaker : 'none'}

${JSON.stringify(batch, null, 2)}

Return a valid JSON object like this example (use exact format):
{
  "segments": [
    {
      "speaker": "Speaker A",
      "text": "Hello there",
      "start": 0.0,
      "end": 1.2
    }
  ]
}`,
          max_tokens: 500,
          temperature: 0.3,
          stop: ["}}", "```"],
        });

        // Clean and parse the response
        let cleanedResponse = completion.choices[0].text.trim();
        // Ensure the response starts with { and ends with }
        const startBrace = cleanedResponse.indexOf('{');
        const endBrace = cleanedResponse.lastIndexOf('}');
        if (startBrace !== -1 && endBrace !== -1) {
          cleanedResponse = cleanedResponse.slice(startBrace, endBrace + 1);
        }

        const gptAnalysis = JSON.parse(cleanedResponse);
        
        if (gptAnalysis?.segments) {
          // Maintain speaker consistency
          const batchSegments = gptAnalysis.segments.map((segment, index) => {
            if (index === 0 && i > 0) {
              const lastProcessed = processedSegments[processedSegments.length - 1];
              const timeGap = (segment.start || segment.start_time) - 
                            (lastProcessed.end || lastProcessed.end_time);
              if (timeGap < 1.0) {
                return { ...segment, speaker: lastProcessed.speaker };
              }
            }
            return segment;
          });
          processedSegments.push(...batchSegments);
        }
      } catch (e) {
        console.error('Failed to parse GPT analysis for batch, using simple detection:', e);
        const detectedSegments = this.detectSpeakerChanges(batch, 
          i > 0 ? processedSegments[processedSegments.length - 1] : null);
        processedSegments.push(...detectedSegments);
      }

      // Add delay between batches
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return processedSegments.map(segment => ({
      speaker: segment.speaker || 'Speaker B',
      text: segment.text,
      start: segment.start || segment.start_time,
      end: segment.end || segment.end_time,
      words: segment.words || [],
      confidence: segment.confidence
    }));
  }

  detectSpeakerChanges(segments, lastProcessedSegment = null) {
    return segments.map((segment, index) => {
      // First segment of all
      if (!lastProcessedSegment && index === 0) {
        return { ...segment, speaker: 'Speaker A' };
      }

      const prevSegment = index === 0 ? lastProcessedSegment : segments[index - 1];
      const timeGap = (segment.start || segment.start_time) - 
                     (prevSegment.end || prevSegment.end_time);
      const prevSpeaker = prevSegment.speaker;

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

  async handleAudioMessage(ws, message, audioChunks, lastProcessedTime) {
    console.log('\n--- Handle Audio Message Start ---');
    const audioBuffer = Buffer.from(message.data);
    audioChunks.push(audioBuffer);
    
    // const currentTime = Date.now();
    // if (currentTime - lastProcessedTime >= 1000) {
    //   try {
    //     console.log('Audio chunks length:', audioChunks.length);
    //     // Take only the new chunk for processing
    //     const tempFilePath = path.join(__dirname, '../temp.webm');
        
    //     // Write the file first
    //     await fs.writeFile(tempFilePath, audioBuffer);
    //     console.log('Temp file written:', tempFilePath);

    //     // Create readable stream from the saved file
    //     const fileStream = fsSync.createReadStream(tempFilePath);
        
    //     const audioFile = await OpenAI.toFile(
    //       fileStream,
    //       'audio.webm'
    //     );

    //     console.log('Getting transcription from OpenAI...');
    //     const transcript = await openai.audio.transcriptions.create({
    //       file: audioFile,
    //       model: 'whisper-1',
    //       response_format: 'verbose_json',
    //       timestamp_granularities: ['word'],
    //       temperature: 0.2,
    //       language: 'en'
    //     });

    //     console.log('Received transcript:', {
    //       text: transcript.text,
    //       duration: transcript.duration,
    //       wordCount: transcript.words?.length
    //     });

    //     if (transcript.text?.trim()) {
    //       const history = this.transcriptionHistory.get(ws) || [];
    //       const lastTranscript = this.lastTranscripts.get(ws) || '';
          
    //       console.log('Current history length:', history.length);
    //       console.log('Last transcript:', lastTranscript);
    //       console.log('New transcript:', transcript.text);

    //       // Check if this is substantially different from the last transcript
    //       const isDifferentEnough = !lastTranscript || 
    //         !transcript.text.includes(lastTranscript);

    //       if (isDifferentEnough) {
    //         console.log('New content detected, creating segment');
            
    //         const newSegment = {
    //           text: transcript.text,
    //           start: transcript.words?.[0]?.start || 0,
    //           end: transcript.words?.[transcript.words.length - 1]?.end || 0,
    //           words: transcript.words || [],
    //           isInterim: true,
    //           speaker: history.length > 0 ? history[history.length - 1].speaker : 'Speaker A'
    //         };

    //         console.log('New segment:', newSegment);

    //         // Keep only the most recent segment
    //         const updatedHistory = [newSegment];
    //         console.log('Updated history length:', updatedHistory.length);

    //         this.transcriptionHistory.set(ws, updatedHistory);
    //         this.lastTranscripts.set(ws, transcript.text);

    //         ws.send(JSON.stringify({
    //           type: 'transcription',
    //           segments: updatedHistory
    //         }));
    //       } else {
    //         console.log('Similar to previous content, skipping update');
    //       }
    //     }

    //     // Clean up temp file
    //     await fs.unlink(tempFilePath).catch(err => 
    //       console.error('Error cleaning up temp file:', err)
    //     );
    //   } catch (error) {
    //     console.error('Real-time processing error:', error);
    //   }
    // }
    // console.log('--- Handle Audio Message End ---\n');
    // return currentTime;
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

      // Get final transcription with speaker diarization
      const segments = await this.processAudioWithDiarization(audioFile);
      const summary = await this.generateSummary(segments);
      
      const conversation = await prisma.conversation.create({
        data: {
          transcript: { segments },
          summary: summary
        }
      });

      // Send final transcript first
      ws.send(JSON.stringify({
        type: 'final_transcript',
        segments
      }));

      // Then send summary
      ws.send(JSON.stringify({
        type: 'summary',
        summary: conversation.summary
      }));

      // Clear history only after sending final transcript
      this.transcriptionHistory.delete(ws);
      
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
