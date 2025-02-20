import React, { useState, useRef, useEffect } from 'react';
import { FaMicrophone, FaStop } from 'react-icons/fa';
import { BiLoader } from 'react-icons/bi';

const App = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [summary, setSummary] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorder = useRef(null);
  const wsRef = useRef(null);
  const audioChunks = useRef([]);
  const timerRef = useRef(null);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const connectWebSocket = () => {
    const ws = new WebSocket(import.meta.env.VITE_WS_URL || 'ws://localhost:3000');

    ws.onopen = () => {
      console.log('Connected to WebSocket');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'transcription':
          setTranscript(prev => {
            const newSegments = message.segments.filter(newSegment => 
              !prev.some(existingSegment => 
                existingSegment.text === newSegment.text &&
                Math.abs(existingSegment.start - newSegment.start) < 0.1
              )
            );
            return [...prev, ...newSegments];
          });
          break;
        case 'final_transcript':
          setTranscript(message.segments);
          break;
        case 'summary':
          setSummary(message.conversation.summary);
          setIsProcessing(false);
          break;
        case 'error':
          console.error('Server error:', message.message);
          setIsProcessing(false);
          // Show error toast or notification here
          break;
      }
    };

    ws.onclose = () => {
      console.log('Disconnected from WebSocket');
      setIsConnected(false);
      setTimeout(connectWebSocket, 3000);
    };

    wsRef.current = ws;
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
        } 
      });
      
      mediaRecorder.current = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
        audioBitsPerSecond: 128000,
      });
      
      audioChunks.current = [];
      setRecordingTime(0);
      
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      mediaRecorder.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.current.push(event.data);
          event.data.arrayBuffer().then(buffer => {
            wsRef.current.send(JSON.stringify({
              type: 'audio',
              data: Array.from(new Uint8Array(buffer))
            }));
          });
        }
      };

      mediaRecorder.current.onstop = () => {
        clearInterval(timerRef.current);
        setIsProcessing(true);
        wsRef.current.send(JSON.stringify({
          type: 'end_recording'
        }));
      };

      mediaRecorder.current.start(1000);
      setIsRecording(true);
      setTranscript([]);
      setSummary('');
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      setIsRecording(false);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold">Conversation Recorder</h1>
          <p className="text-gray-400">Record, transcribe, and summarize your conversations</p>
        </div>

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

          {isProcessing && (
            <div className="flex items-center gap-2 text-blue-400">
              <BiLoader className="w-5 h-5 animate-spin" />
              <span>Processing recording...</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gray-800 rounded-xl p-6 shadow-xl">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              Live Transcript
              {isRecording && <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
            </h2>
            <div className="h-96 overflow-y-auto space-y-3 custom-scrollbar">
              {transcript.map((segment, index) => (
                <div 
                  key={index} 
                  className={`p-3 rounded-lg ${
                    segment.speaker === 'Speaker A' 
                      ? 'bg-blue-900/50 ml-4' 
                      : 'bg-green-900/50 mr-4'
                  }`}
                >
                  <div className={`font-semibold mb-1 ${
                    segment.speaker === 'Speaker A' ? 'text-blue-400' : 'text-green-400'
                  }`}>
                    {segment.speaker}
                  </div>
                  <div>{segment.text}</div>
                </div>
              ))}
            </div>
          </div>

          
            <div className="bg-gray-800 rounded-xl p-6 shadow-xl">
              <h2 className="text-xl font-semibold mb-4">Summary</h2>
              <div className="prose prose-invert max-w-none">
                <div className="whitespace-pre-wrap">{summary}</div>
              </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default App;