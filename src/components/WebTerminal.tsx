import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

const WS_URL = 'ws://localhost:8081';

const WebTerminal = () => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');

  useEffect(() => {
    if (!terminalRef.current) return;

    // สร้างเทอร์มินัล
    const term = new Terminal({
      theme: {
        background: '#0f1115',
        foreground: '#e5e7eb',
        cursor: '#3b82f6',
        black: '#1f2937',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#8b5cf6',
        cyan: '#06b6d4',
        white: '#f9fafb',
      },
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      rows: 18,
    });

    term.open(terminalRef.current);
    termRef.current = term;

    term.writeln('🔌 กำลังเชื่อมต่อ Terminal Server...');
    term.writeln('');

    // เชื่อมต่อ WebSocket
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      term.writeln('✅ เชื่อมต่อสำเร็จ! พิมพ์คำสั่งได้เลยครับ');
      term.writeln('');
    };

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    ws.onclose = () => {
      setStatus('disconnected');
      term.writeln('\r\n\x1b[31m🔌 การเชื่อมต่อถูกปิด\x1b[0m');
    };

    ws.onerror = () => {
      setStatus('disconnected');
      term.writeln('\r\n\x1b[31m❌ ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้\x1b[0m');
      term.writeln('\x1b[33m💡 อย่าลืมรัน: node server/terminal-server.mjs\x1b[0m\r\n');
    };

    // ส่งข้อมูลที่พิมพ์ไปยังเซิร์ฟเวอร์
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    return () => {
      ws.close();
      term.dispose();
    };
  }, []);

  return (
    <div className="w-full border border-gray-700 rounded-lg overflow-hidden bg-gray-900">
      <div className="bg-gray-800 px-4 py-2 flex items-center gap-2 border-b border-gray-700">
        <div className="w-3 h-3 rounded-full bg-red-500"></div>
        <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
        <div className="w-3 h-3 rounded-full bg-green-500"></div>
        <span className="text-gray-400 text-sm ml-2">
          Terminal — /runner
        </span>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded ${
          status === 'connected' ? 'bg-green-900 text-green-300' :
          status === 'connecting' ? 'bg-yellow-900 text-yellow-300' :
          'bg-red-900 text-red-300'
        }`}>
          {status === 'connected' ? '🟢 เชื่อมต่อแล้ว' :
           status === 'connecting' ? '🟡 กำลังเชื่อมต่อ...' :
           '🔌 ไม่เชื่อมต่อ'}
        </span>
      </div>
      <div
        ref={terminalRef}
        className="p-2 h-[400px] overflow-auto"
      />
    </div>
  );
};

export default WebTerminal;
