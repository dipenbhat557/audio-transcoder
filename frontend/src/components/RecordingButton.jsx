import React, { useRef } from 'react';
import { FaMicrophone, FaStop } from 'react-icons/fa';
import Loader from './Loader';
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { v4 as uuidv4 } from 'uuid';
const RecordingButton = ({
  isRecording,
  setIsRecording,
  isConnected,
  isProcessing, 
  setIsProcessing,
  recordingTime,
  setRecordingTime,
  transcriptHistory,
  setTranscriptHistory,
  setSummary,
  wsRef
}) => {
  const mediaRecorder = useRef(null);
  const timerRef = useRef(null);
  const deepgramLive = useRef(null);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const startRecording = async () => {
    try {
      console.log("Starting recording...");
      setTranscriptHistory([]);
      setSummary('');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      const options = {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 128000
      };

      const deepgram = createClient(import.meta.env.VITE_DEEPGRAM_API_KEY);
      
      console.log("Deepgram API key:", import.meta.env.VITE_DEEPGRAM_API_KEY);
      deepgramLive.current = deepgram.listen.live({
        model: "nova-3",
        language: "en",
        smart_format: true,
        interim_results: true,
        diarize: true
      });
      console.log("Deepgram live:", deepgramLive.current);

      let isDeepgramReady = false;
      deepgramLive.current.on(LiveTranscriptionEvents.Open, () => {
        console.log("Connected to Deepgram");
        isDeepgramReady = true;
      });

      deepgramLive.current.on(LiveTranscriptionEvents.Close, () => {
        console.log("Disconnected from Deepgram");
        isDeepgramReady = false;
      });

      deepgramLive.current.on(LiveTranscriptionEvents.Transcript, (data) => {
        console.log("Transcript received:", data);
        if (data.channel?.alternatives?.[0]) {
          const transcript = data.channel.alternatives[0];
          console.log("Transcript details:", transcript);
          
          // Skip processing if no words
          if (!transcript.words || transcript.words.length === 0) {
            console.warn("Received empty transcript.");
            return;
          }

          // Group words by speaker and combine them
          const speakerGroups = transcript.words.reduce((groups, word) => {
            const speaker = `Speaker ${word.speaker + 1}`;
            if (!groups[speaker]) {
              groups[speaker] = {
                words: [],
                start: word.start,
                end: word.end
              };
            }
            groups[speaker].words.push(word.word);
            groups[speaker].end = word.end;
            return groups;
          }, {});

          // Convert groups to segments
          const segments = Object.entries(speakerGroups).map(([speaker, group]) => ({
            speaker,
            text: group.words.join(' '),
            start: group.start,
            end: group.end
          }));

          // Process new segments
          if (segments.length > 0) {
            setTranscriptHistory(prev => {
              const newHistory = [...prev];

              segments.forEach(segment => {
                // Check for duplicates across all segments
                const isDuplicate = newHistory.some(existing => 
                  existing.speaker === segment.speaker && 
                  existing.text === segment.text
                );

                if (!isDuplicate) {
                  // Check if the current segment is a continuation of the last segment
                  const lastSegment = newHistory[newHistory.length - 1];
                  if (lastSegment && lastSegment.speaker === segment.speaker) {
                    // If the last segment ends with the current segment's text, append it
                    if (lastSegment.text.endsWith(segment.text)) {
                      lastSegment.text += ` ${segment.text}`;
                    } else {
                      // Add as a new segment
                      newHistory.push(segment);
                    }
                  } else {
                    // Add as a new segment
                    newHistory.push(segment);
                  }
                }
              });

              return newHistory;
            });
          }

          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: "transcript_update",
              segments: segments
            }));
          }
        } else {
          console.warn("No alternatives found in transcript data.");
        }
      });

      deepgramLive.current.on(LiveTranscriptionEvents.Error, (error) => {
        console.error("Deepgram error:", error);
      });

      deepgramLive.current.on(LiveTranscriptionEvents.Warning, (warning) => {
        console.warn("Deepgram warning:", warning);
      });

      mediaRecorder.current = new MediaRecorder(stream, options);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      mediaRecorder.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          const reader = new FileReader();
          reader.onloadend = () => {
            console.log("Sending audio data to Deepgram...");
            console.log("Audio data size:", reader.result.byteLength);
            if (isDeepgramReady && deepgramLive.current?.getReadyState() === 1) {
              try {
                console.log("reader data is ", reader.result);
                deepgramLive.current.send(reader.result);
                deepgramLive.current.keepAlive();
                console.log("Audio data sent successfully to Deepgram");
              } catch (error) {
                console.error("Error sending audio to Deepgram:", error);
              }
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(reader.result);
              }
            } else {
              console.warn("Deepgram connection is not ready to send data. Ready state:", deepgramLive.current?.getReadyState());
            }
          };
          console.log("Reading audio data...", event.data);
          reader.readAsArrayBuffer(event.data);
        }
      };

      mediaRecorder.current.onstop = () => {
        clearInterval(timerRef.current);
        if (deepgramLive.current) {
          deepgramLive.current.requestClose();
        }
        const namespace = uuidv4();
        localStorage.setItem('conversationNamespace', namespace);
        
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'end_recording', namespace }));
        }
        setIsRecording(false);
        setIsProcessing(true);
      };

      mediaRecorder.current.start(1000);
      setIsRecording(true);
      setIsProcessing(false);
    } catch (error) {
      console.error('Error starting recording:', error);
      setIsProcessing(false);
    }
  };

  const stopRecording = () => {
    console.log("Stopping recording...");
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
    }
  };

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative">
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={!isConnected || isProcessing}
          className={`
            w-24 h-24 rounded-full flex items-center justify-center
            transition-all duration-300 transform hover:scale-105
            ${!isConnected 
              ? 'bg-gray-600 cursor-not-allowed'
              : isRecording 
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-blue-500 hover:bg-blue-600'
            }
          `}
        >
          {isRecording ? (
            <FaStop className="w-8 h-8" />
          ) : (
            <FaMicrophone className="w-8 h-8" />
          )}
        </button>
        <div className={`absolute -top-2 -right-2 w-4 h-4 rounded-full 
          ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
      </div>
      {isRecording && (
        <div className="text-2xl font-mono text-red-500">
          {formatTime(recordingTime)}
        </div>
      )}
      {isProcessing && <Loader />}
    </div>
  );
};

export default RecordingButton; 