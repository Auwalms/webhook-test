import express from 'express';
import { config } from './config.js';
import { loansRouter } from './routes/loans.routes.js';
import { mandatesRouter } from './routes/mandates.routes.js';
import { webhooksRouter } from './routes/webhooks.routes.js';


export const app = express();


app.use('/webhooks', express.raw({ type: 'application/json' }), webhooksRouter);


app.use(express.json());
app.use('/loans', loansRouter);
app.use('/mandates', mandatesRouter);


app.listen(config.port, () => {
  console.log(`Lending Engine running at http://localhost:${config.port}`);
});