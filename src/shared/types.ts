export const SCHEMA_VERSION = 1;

export type RouteType = 'linear' | 'circular' | 'free';

export interface PassCode {
  /** שאלה/הנחיה (אופציונלי) */
  prompt: string;
  /** תשובות מתקבלות */
  answers: string[];
  /** טקסט/רמז שנחשף בהצלחה (אופציונלי) */
  reveal: string;
}

export interface Station {
  /** מזהה קבוע — לא תלוי במיקום ברשימה */
  id: string;
  name: string;
  content: string;
  imageId?: string;
  link?: string;
  submit: { text: boolean; photo: boolean; audio: boolean };
  code?: PassCode;
}

export interface Intro {
  text: string;
  imageId?: string;
  link?: string;
}

export interface Game {
  schemaVersion: typeof SCHEMA_VERSION;
  title: string;
  routeType: RouteType;
  intro: Intro;
  stations: Station[];
}

/** מה שהשרת מחזיר לתלמיד */
export interface PublishedGame {
  id: string;
  version: number;
  game: Game;
}

export const LIMITS = {
  maxStations: 25,
  maxImagesPerGame: 30,
  maxImageBytes: 400 * 1024, // יעד ~300KB אחרי כיווץ, עם מרווח
  imageMaxDim: 1280,
  imageTargetBytes: 300 * 1024,
  maxGameJsonBytes: 200 * 1024,
  title: 100,
  stationName: 80,
  text: 4000,
  link: 500,
  codeAnswer: 100,
  maxAnswers: 10,
  studentPhotosPerStation: 3,
  audioMaxSeconds: 60,
} as const;

export const ROUTE_LABELS: Record<RouteType, { title: string; hint: string }> = {
  linear: {
    title: 'מסלול קווי — התחלה וסיום',
    hint: 'התלמידים עוברים תחנה אחרי תחנה לפי הסדר שקבעתם. התחנה האחרונה ברשימה היא תחנת הסיום.',
  },
  circular: {
    title: 'מסלול מעגלי — התחלה מכל תחנה',
    hint: 'הסדר קבוע ומחזורי, אבל כל קבוצה בוחרת מאיפה להתחיל. כך אפשר לפזר קבוצות על פני התחנות.',
  },
  free: {
    title: 'תחנות חופשיות — בכל סדר',
    hint: 'התלמידים בוחרים בכל שלב לאיזו תחנה ללכת. אם רוצים "8 מתוך 10", כתבו זאת במסך הפתיחה.',
  },
};
