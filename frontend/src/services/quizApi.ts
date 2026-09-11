import axios from 'axios';
import { getAuthHeader } from './authApi';

export type QuizQuestionType = 'mcq' | 'number' | 'true_false';

export interface QuizQuestion {
  id: string;
  section?: string;
  type: QuizQuestionType | string;
  prompt: string;
  choices?: string[];
  correctAnswer: string | number | boolean;
  explanation?: string;
  requiresHistory?: boolean;
  historyHint?: string;
}

export interface PlayQuiz {
  id: string;
  title: string;
  kind: 'quiz';
  learningOutcome: string;
  difficulty?: string;
  tags?: string[];
  panelLabel: string;
  domainId: string;
  passScore: number;
  sideQuest: { title: string; subtitle: string };
  exhibit: {
    submissionId: string;
    historyAppId: string | null;
    historyUrl: string | null;
    codePath: string;
    code: string;
  };
  questions: QuizQuestion[];
}

export interface QuizListItem {
  id: string;
  title: string;
  kind: 'quiz';
  learningOutcome: string;
  difficulty?: string;
  tags?: string[];
  panelLabel: string;
  domainId: string;
  sideQuest: { title: string; subtitle: string };
}

export async function listQuizzes(): Promise<QuizListItem[]> {
  const { data } = await axios.get<{ quizzes: QuizListItem[] }>('/api/quizzes', {
    headers: getAuthHeader(),
  });
  return data.quizzes || [];
}

export async function fetchQuiz(id: string): Promise<PlayQuiz> {
  const { data } = await axios.get<{ quiz: PlayQuiz }>(`/api/quizzes/${encodeURIComponent(id)}`, {
    headers: getAuthHeader(),
  });
  return data.quiz;
}
