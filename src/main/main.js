// Electron entry point. All the work lives in app.js so it can also be started headlessly by tests.
import { startApp } from './app.js';

startApp().catch((err) => {
  console.error('Horologium failed to start:', err);
  process.exit(1);
});
