// יוצר examples/sample-game.json ו-examples/sample-game.zip (בלי תמונות) — דוגמה לייבוא "פתח משחק ששמרתי".
import { mkdirSync, writeFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';

const game = {
  schemaVersion: 1,
  title: 'סיור בבית הספר',
  routeType: 'circular',
  intro: { text: 'ברוכים הבאים! מצאו את התחנות בבית הספר, בצעו את המשימות ובסוף לחצו "סיימתי". אפשר להתחיל מכל תחנה לפי הנחיית המורה.' },
  stations: [
    {
      id: 'station001',
      name: 'תחנה 1',
      content: 'מצאו ליד הכניסה לספרייה את השעון הישן. כמה פעמים הוא מצלצל בצהריים? כתבו את התשובה וצלמו את השעון.',
      submit: { text: true, photo: true, audio: false },
      code: { prompt: 'כמה פעמים מצלצל השעון בצהריים?', answers: ['12', 'שתים עשרה', 'שתים-עשרה'], reveal: 'כל הכבוד! התחנה הבאה נמצאת ליד המעבדה.' },
    },
    {
      id: 'station002',
      name: 'תחנה 2',
      content: 'הקליטו את הקבוצה שלכם מספרת במשפט אחד מה למדתם בתחנה הקודמת.',
      submit: { text: false, photo: false, audio: true },
    },
    {
      id: 'station003',
      name: 'תחנה 3',
      content: 'קראו את ההסבר בקישור וכתבו שני משפטים על מה שלמדתם.',
      link: 'https://www.example.com/',
      submit: { text: true, photo: false, audio: false },
    },
  ],
};

mkdirSync('examples', { recursive: true });
writeFileSync('examples/sample-game.json', JSON.stringify({ schemaVersion: 1, game, images: {} }, null, 2));
writeFileSync('examples/sample-game.zip', zipSync({ 'game.json': strToU8(JSON.stringify({ schemaVersion: 1, game, images: {} }, null, 2)) }, { level: 0 }));
console.log('נוצרו examples/sample-game.json ו-examples/sample-game.zip');
