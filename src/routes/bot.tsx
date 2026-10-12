import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { processMessageWithTools } from '~/lib/bot-with-tools';

export const Route = createFileRoute('/bot')({
  component: BotPage,
});

function BotPage() {
  const [messages, setMessages] = useState<Array<{
    role: string;
    text: string;
    toolUsed?: boolean;
  }>>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    
    const userMsg = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsLoading(true);

    const result = await processMessageWithTools(userMsg);
    
    setMessages(prev => [...prev, {
      role: 'bot',
      text: result.reply,
      toolUsed: result.toolUsed,
    }]);
    
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 md:p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">🤖 บอทผู้ช่วย — มีเครื่องมือในตัว 🛠️</h1>
        <p className="text-gray-400 text-sm mb-6">พิมพ์: "ดูไฟล์", "รันคำสั่ง", "อ่านไฟล์"</p>
        
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 h-[500px] overflow-y-auto mb-4 space-y-4">
          {messages.length === 0 && (
            <p className="text-gray-500 text-center mt-20">
              🛠️ บอทพร้อมใช้งานเครื่องมือแล้ว!<br />
              ลองพิมพ์: <span className="text-blue-400">"ดูไฟล์ทั้งหมด"</span> หรือ <span className="text-blue-400">"รัน ls -la"</span>
            </p>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`mb-3 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
              {msg.toolUsed && (
                <div className="text-xs text-yellow-400 mb-1 flex items-center gap-1">
                  🛠️ ใช้เครื่องมือทำงาน...
                </div>
              )}
              <div className={`inline-block max-w-[85%] px-4 py-3 rounded-lg whitespace-pre-wrap ${
                msg.role === 'user' 
                  ? 'bg-blue-600 text-white rounded-br-sm' 
                  : 'bg-gray-800 text-gray-200 rounded-bl-sm border border-gray-700'
              }`}>
                {msg.text}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="text-left mb-3">
              <div className="inline-block bg-gray-800 text-gray-200 px-4 py-3 rounded-lg rounded-bl-sm border border-gray-700">
                <span className="animate-pulse">🧠 กำลังคิดและเตรียมเครื่องมือ...</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="พิมพ์คำสั่งหรือคำถาม..."
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleSend}
            disabled={isLoading}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-6 py-3 rounded-lg transition-colors"
          >
            ส่ง
          </button>
        </div>
      </div>
    </div>
  );
}
