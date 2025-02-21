import React, { useState, useRef, useEffect } from 'react';
import { FaMicrophone, FaStop } from 'react-icons/fa';
import { BiLoader } from 'react-icons/bi';

const App = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcriptHistory, setTranscriptHistory] = useState([]);
  const [finalTranscript, setFinalTranscript] = useState([]);
  const [summary, setSummary] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [questionHistory, setQuestionHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('transcript');
  const [isGeneratingAnswer, setIsGeneratingAnswer] = useState(false);
  
  const mediaRecorder = useRef(null);
  const wsRef = useRef(null);
  const audioChunks = useRef([]);
  const timerRef = useRef(null);
  const transcriptEndRef = useRef(null);

  useEffect(() => {
    connectWebSocket();
    window.scrollTo(0, 0);
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!answer) return;
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [answer]);

  const mergeTranscripts = (segments) => {
    console.log('\n--- Merging Transcripts ---');
    console.log('Input segments:', segments.length);
    
    const merged = segments.reduce((acc, curr) => {
      const last = acc[acc.length - 1];

      console.log("last", last);
      console.log("curr", curr);
      
      if (last && last.speaker === curr.speaker && 
          curr.start - last.end < 2.0) {
        console.log('Merging segment with previous:', {
          prev: last.text,
          curr: curr.text
        });
        // Merge with previous segment
        last.text = `${last.text} ${curr.text}`;
        last.end = curr.end;
        // last.words = [...last.text, ...curr.text];
        return acc;
      }
      
      // Add as new segment
      console.log('Adding new segment:', curr.text);
      return [...acc, { ...curr }];
    }, []);

    console.log('Output segments:', merged.length);
    console.log('--- Merge Complete ---\n');
    return merged;
  };

  const connectWebSocket = () => {
    const ws = new WebSocket(import.meta.env.VITE_WS_URL || 'ws://localhost:3000');

    ws.onopen = () => {
      console.log('Connected to WebSocket');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      console.log('\n--- WebSocket Message Received ---');
      const message = JSON.parse(event.data);
      console.log('Message type:', message.type);
      
      switch (message.type) {
        case 'transcription':
          if (message.segments) {
            console.log('Received segments:', {
              count: message.segments.length,
              lastSegment: message.segments[message.segments.length - 1]
            });

            setTranscriptHistory(prev => {
              console.log('Previous history length:', prev.length);
              const mergedSegments = mergeTranscripts(message.segments);
              console.log('Merged segments length:', mergedSegments.length);
              console.log('Last merged segment:', mergedSegments[mergedSegments.length - 1]);
              return mergedSegments;
            });
          }
          break;
        case 'final_transcript':
          console.log('Received final transcript:', {
            segmentCount: message.segments.length
          });
          setTranscriptHistory([]);
          setFinalTranscript(mergeTranscripts(message.segments));
          break;
        case 'summary':
          console.log('Received summary');
          setSummary(message.summary);
          setIsProcessing(false);
          break;
        case 'error':
          console.error('Server error:', message.message);
          setIsProcessing(false);
          break;
      }
      console.log('--- WebSocket Message End ---\n');
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
      setTranscriptHistory([]);
      setFinalTranscript([]);
      setSummary('');
      
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      mediaRecorder.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.current.push(event.data);
          event.data.arrayBuffer().then(buffer => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: 'audio',
                data: Array.from(new Uint8Array(buffer))
              }));
            }
          });
        }
      };

      mediaRecorder.current.onstop = () => {
        clearInterval(timerRef.current);
        setIsProcessing(true);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'end_recording'
          }));
        }
      };

      mediaRecorder.current.start(1000);
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      setIsRecording(false);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'end_recording'
        }));
      }
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleAskQuestion = async () => {
    if (!question.trim()) return;
    
    setIsGeneratingAnswer(true);
    try {
        const embeddingResponse = await fetch(`${import.meta.env.VITE_API_URL}/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question })
        });
        const { embedding } = await embeddingResponse.json();

        const response = await fetch(`${import.meta.env.VITE_API_URL}/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vector: embedding, question })
        });
        const data = await response.json();
        
        setQuestionHistory(prev => [...prev, { 
            question, 
            answer: data.answer,
            timestamp: new Date().toISOString()
        }]);
        setQuestion('');
        setAnswer(data.answer);
    } catch (error) {
        console.error('Error asking question:', error);
        setAnswer('Error getting answer.');
    } finally {
        setIsGeneratingAnswer(false);
    }
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

        <div className="flex space-x-4 border-b border-gray-700">
          <button
            onClick={() => setActiveTab('transcript')}
            className={`px-4 cursor-pointer py-2 font-medium transition-colors ${
              activeTab === 'transcript' ? 'tab-active' : 'text-gray-400 hover:text-white'
            }`}
          >
            Transcript & Summary
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            className={`px-4 cursor-pointer py-2 font-medium transition-colors ${
              activeTab === 'chat' ? 'tab-active' : 'text-gray-400 hover:text-white'
            }`}
          >
            Chat Assistant
          </button>
        </div>

        {activeTab === 'transcript' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gray-800 rounded-xl p-6 shadow-xl">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                Audio Transcript
                {isRecording && <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
              </h2>
              <div className="h-96 overflow-y-auto space-y-3 custom-scrollbar">
                {finalTranscript.map((segment, index) => (
                  <div 
                    key={`final-${index}`} 
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

                {isRecording && transcriptHistory.map((segment, index) => (
                  <div 
                    key={`interim-${index}`}
                    className={`p-3 rounded-lg ${
                      segment.speaker === 'Speaker A' 
                        ? 'bg-blue-900/30 ml-4' 
                        : 'bg-green-900/30 mr-4'
                    } animate-pulse`}
                  >
                    <div className={`font-semibold mb-1 ${
                      segment.speaker === 'Speaker A' ? 'text-blue-400' : 'text-green-400'
                    }`}>
                      {segment.speaker}
                    </div>
                    <div>{segment.text}</div>
                  </div>
                ))}
                <div ref={transcriptEndRef} />
              </div>
            </div>

            <div className="bg-gray-800 rounded-xl p-6 shadow-xl">
              <h2 className="text-xl font-semibold mb-4">Summary</h2>
              <div className="prose prose-invert max-w-none">
                <div className="whitespace-pre-wrap">{summary}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-gray-800 rounded-xl shadow-xl overflow-y-auto flex flex-col h-[300px]">
            <div className="flex-1 p-6 overflow-y-auto custom-scrollbar space-y-4">
              {questionHistory.map((item, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex justify-end">
                    <div className="bg-blue-600 rounded-lg p-3 max-w-[80%] chat-bubble">
                      <p className="text-white">{item.question}</p>
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="bg-gray-700 rounded-lg p-3 max-w-[80%] chat-bubble">
                      <p className="text-white">{item.answer}</p>
                    </div>
                  </div>
                </div>
              ))}
              {isGeneratingAnswer && (
                <div className="flex justify-start">
                  <div className="bg-gray-700 rounded-lg p-3">
                    <div className="typing-indicator">
                      <div className="typing-dot"></div>
                      <div className="typing-dot"></div>
                      <div className="typing-dot"></div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-700">
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAskQuestion()}
                  className="flex-1 p-2 rounded bg-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ask about the conversation..."
                  disabled={isGeneratingAnswer}
                />
                <button
                  onClick={handleAskQuestion}
                  disabled={isGeneratingAnswer}
                  className={`px-4 py-2 rounded font-medium transition-colors ${
                    isGeneratingAnswer 
                      ? 'bg-gray-600 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;