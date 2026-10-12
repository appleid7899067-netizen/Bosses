import { createFileRoute } from '@tanstack/react-router';
import WebTerminal from '@/components/WebTerminal';

export const Route = createFileRoute('/runner')({
  component: RunnerPage,
});

function RunnerPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 md:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">⚡ Runner — Terminal</h1>
          <p className="text-gray-400">สภาพแวดล้อมการรันคำสั่งแบบฝังในหน้าเว็บ</p>
        </div>
        <WebTerminal />
        <div className="mt-4 text-sm text-gray-500">
          💡 หมายเหตุ: ตอนนี้เป็นโหมดแสดงผล
        </div>
      </div>
    </div>
  );
}
