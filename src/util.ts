import { timeOnDay } from './domain/dates';
import type { Entry, ItemTemplate, MealType, Origin } from './domain/types';

export function guessMealType(d: Date = new Date()): MealType {
  const h = d.getHours();
  if (h >= 4 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 17 && h < 22) return 'dinner';
  return 'snack';
}

export function newEntry(day: string, origin: Origin, extra: Partial<Entry> = {}): Entry {
  return { day, time: timeOnDay(day), mealType: guessMealType(), title: '', isRestaurant: false, origin, ...extra };
}

export function titleFromItems(items: ItemTemplate[]): string {
  if (items.length === 0) return 'Empty entry';
  const names = items.slice(0, 3).map((i) => i.name);
  return names.join(', ') + (items.length > 3 ? ` +${items.length - 3} more` : '');
}

export function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
