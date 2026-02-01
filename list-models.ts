import { AIService } from './src/services/ai.service.js';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
    const ai = AIService.getInstance();
    try {
        console.log('Listing models...');
        const models = await ai.listModels();
        console.log('Available models:', models);
    } catch (e) {
        console.error('Failed:', e);
    }
}
main();
