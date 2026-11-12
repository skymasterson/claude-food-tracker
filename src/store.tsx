import { createContext, useContext, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { loadSettings, type Settings } from './db/repo';
import { dayKey } from './domain/dates';
import type { Entry, ItemTemplate } from './domain/types';

/** The meal being reviewed before it is saved. Held in memory only. */
export interface MealDraft {
  entry: Entry;
  items: ItemTemplate[];
  warnings: string[];
}
let draft: MealDraft | null = null;
export const setDraft = (d: MealDraft | null) => {
  draft = d;
};
export const getDraft = () => draft;

const DayContext = createContext<{ day: string; setDay: (d: string) => void }>({ day: dayKey(), setDay: () => {} });
export function DayProvider({ children }: { children: ReactNode }) {
  const [day, setDay] = useState(dayKey());
  return <DayContext.Provider value={{ day, setDay }}>{children}</DayContext.Provider>;
}
export const useDay = () => useContext(DayContext);

export function useSettings(): Settings | undefined {
  return useLiveQuery(loadSettings, []);
}
