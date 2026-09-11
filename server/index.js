import express from 'express';
import cors from 'cors';
import { qaRouter } from './routes/qa.js';
import { checkCapabilities } from './lib/capabilities.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/health', async (req, res) => {
  const capabilities = await checkCapabilities();
  res.json({ ok: true, capabilities });
});

app.use('/api/qa', qaRouter);

app.listen(PORT, () => {
  console.log(`QA Workbench API listening on http://localhost:${PORT}`);
});
