Tóm tắt 3 terminal cần chạy đồng thời:
Terminal	Lệnh	Vai trò
1	npm run dev -- --port 3001	Next.js UI
2	SCAN_URL=http://localhost:3001/api/solana-gems npm run trade-worker	Tự scan gem + quản lý bán

cd "/Users/phungvanthien/Desktop/AI Trading/Gems-AI Agent/alphahunter-ai"
SCAN_URL=http://localhost:3001/api/solana-gems npm run trade-worker

3	(optional) npm run outcome-worker	Học kết quả trade
4   Worker 
npm run trade-worker