import React, { useRef, useEffect } from 'react';

const ChatAssistant = ({ question, setQuestion, questionHistory, setQuestionHistory, isGeneratingAnswer, setIsGeneratingAnswer, setAnswer }) => {

  const chatContainerRef = useRef(null);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [questionHistory]);

  const handleAskQuestion = async () => {
    if (!question.trim()) return;
    setIsGeneratingAnswer(true);
    try {
      const namespace = localStorage.getItem('conversationNamespace');
      if(!namespace) {
        setAnswer('No conversation found. Please start a new conversation.');
        setQuestionHistory(prev => [...prev, { 
          question, 
          answer: 'No conversation found. Please start a new conversation.',
          timestamp: new Date().toISOString()
        }]);
        setIsGeneratingAnswer(false);
        setQuestion('');
        return;
      }

      const response = await fetch(`${import.meta.env.VITE_API_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, namespace })
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
    <div className="bg-gray-800 rounded-xl shadow-xl overflow-y-auto flex flex-col h-[300px]">
      <div className="flex-1 p-6 overflow-y-auto custom-scrollbar space-y-4" ref={chatContainerRef}>
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
  );
};

export default ChatAssistant; 