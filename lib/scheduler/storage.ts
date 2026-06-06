// 근무 일지(scheduler) 데이터 계층 — 로컬 프로젝트의 Firebase(acscentmanager)에 연결.
// 원본(scheduler)의 utils/storage.ts 를 그대로 이식하되, 모듈 전역 db 대신
// 로컬의 lazy 초기화(getDb)를 사용한다. env 미설정/DB 미생성 시에도 throw 하지 않고
// 빈 배열/null/void 로 안전 반환(로컬 lib/db.ts 와 동일한 가드 규칙).
//
// 사용 컬렉션(로컬 기존 컬렉션과 겹치지 않는 신규 컬렉션):
//   employees / schedules / weekSchedules / weekNotes
// 기존 로컬 컬렉션(shifts/tasks/taskChecks/events/products/promotions/settings)과 분리되어
// 서로 영향이 없다.
import { Employee, WorkSchedule } from '@/lib/scheduler/types';
import { getDb } from '@/lib/firebase';
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
} from 'firebase/firestore';

const EMPLOYEES_COLLECTION = 'employees';
const SCHEDULES_COLLECTION = 'schedules';
const WEEK_SCHEDULES_COLLECTION = 'weekSchedules';
const WEEK_NOTES_COLLECTION = 'weekNotes';

export const storage = {
  // Employee methods
  getEmployees: async (): Promise<Employee[]> => {
    const db = getDb();
    if (!db) return [];
    try {
      const querySnapshot = await getDocs(collection(db, EMPLOYEES_COLLECTION));
      return querySnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Employee));
    } catch (error) {
      console.error('Error getting employees:', error);
      return [];
    }
  },

  saveEmployees: async (employees: Employee[]): Promise<void> => {
    const db = getDb();
    if (!db) return;
    try {
      const promises = employees.map(employee =>
        setDoc(doc(db, EMPLOYEES_COLLECTION, employee.id), employee)
      );
      await Promise.all(promises);
    } catch (error) {
      console.error('Error saving employees:', error);
    }
  },

  addEmployee: async (employee: Employee): Promise<void> => {
    const db = getDb();
    if (!db) return;
    try {
      await setDoc(doc(db, EMPLOYEES_COLLECTION, employee.id), employee);
    } catch (error) {
      console.error('Error adding employee:', error);
    }
  },

  updateEmployee: async (id: string, updatedEmployee: Employee): Promise<void> => {
    const db = getDb();
    if (!db) return;
    try {
      await setDoc(doc(db, EMPLOYEES_COLLECTION, id), updatedEmployee);
    } catch (error) {
      console.error('Error updating employee:', error);
    }
  },

  deleteEmployee: async (id: string): Promise<void> => {
    const db = getDb();
    if (!db) return;
    try {
      await deleteDoc(doc(db, EMPLOYEES_COLLECTION, id));
    } catch (error) {
      console.error('Error deleting employee:', error);
    }
  },

  // Schedule methods
  getSchedules: async (): Promise<WorkSchedule[]> => {
    const db = getDb();
    if (!db) return [];
    try {
      const querySnapshot = await getDocs(collection(db, SCHEDULES_COLLECTION));
      return querySnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as WorkSchedule));
    } catch (error) {
      console.error('Error getting schedules:', error);
      return [];
    }
  },

  saveSchedules: async (schedules: WorkSchedule[]): Promise<void> => {
    const db = getDb();
    if (!db) return;
    try {
      const promises = schedules.map(schedule =>
        setDoc(doc(db, SCHEDULES_COLLECTION, schedule.id), schedule)
      );
      await Promise.all(promises);
    } catch (error) {
      console.error('Error saving schedules:', error);
    }
  },

  addSchedule: async (schedule: WorkSchedule): Promise<void> => {
    const db = getDb();
    if (!db) return;
    try {
      await setDoc(doc(db, SCHEDULES_COLLECTION, schedule.id), schedule);
    } catch (error) {
      console.error('Error adding schedule:', error);
    }
  },

  updateSchedule: async (id: string, updatedSchedule: WorkSchedule): Promise<void> => {
    const db = getDb();
    if (!db) return;
    try {
      await setDoc(doc(db, SCHEDULES_COLLECTION, id), updatedSchedule);
    } catch (error) {
      console.error('Error updating schedule:', error);
    }
  },

  deleteSchedule: async (id: string): Promise<void> => {
    const db = getDb();
    if (!db) return;
    try {
      await deleteDoc(doc(db, SCHEDULES_COLLECTION, id));
    } catch (error) {
      console.error('Error deleting schedule:', error);
    }
  },

  getSchedulesByEmployee: async (employeeId: string): Promise<WorkSchedule[]> => {
    const db = getDb();
    if (!db) return [];
    try {
      const q = query(
        collection(db, SCHEDULES_COLLECTION),
        where('employeeId', '==', employeeId)
      );
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as WorkSchedule));
    } catch (error) {
      console.error('Error getting schedules by employee:', error);
      return [];
    }
  },

  getSchedulesByDateRange: async (startDate: string, endDate: string): Promise<WorkSchedule[]> => {
    const db = getDb();
    if (!db) return [];
    try {
      const q = query(
        collection(db, SCHEDULES_COLLECTION),
        where('date', '>=', startDate),
        where('date', '<=', endDate)
      );
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as WorkSchedule));
    } catch (error) {
      console.error('Error getting schedules by date range:', error);
      return [];
    }
  },

  // Week schedules (for WeeklySchedule component)
  getWeekSchedules: async (weekKey: string): Promise<any> => {
    const db = getDb();
    if (!db) return null;
    try {
      const docRef = doc(db, WEEK_SCHEDULES_COLLECTION, weekKey);
      const docSnap = await getDoc(docRef);
      return docSnap.exists() ? docSnap.data() : null;
    } catch (error) {
      console.error('Error getting week schedules:', error);
      return null;
    }
  },

  saveWeekSchedules: async (weekKey: string, schedules: any): Promise<void> => {
    const db = getDb();
    if (!db) return;
    try {
      await setDoc(doc(db, WEEK_SCHEDULES_COLLECTION, weekKey), schedules);
    } catch (error) {
      console.error('Error saving week schedules:', error);
    }
  },

  // Week notes (for EVENT and 비고)
  getWeekNotes: async (weekKey: string): Promise<any> => {
    const db = getDb();
    if (!db) return null;
    try {
      const docRef = doc(db, WEEK_NOTES_COLLECTION, weekKey);
      const docSnap = await getDoc(docRef);
      return docSnap.exists() ? docSnap.data() : null;
    } catch (error) {
      console.error('Error getting week notes:', error);
      return null;
    }
  },

  saveWeekNotes: async (weekKey: string, notes: any): Promise<void> => {
    const db = getDb();
    if (!db) return;
    try {
      await setDoc(doc(db, WEEK_NOTES_COLLECTION, weekKey), notes);
    } catch (error) {
      console.error('Error saving week notes:', error);
    }
  },
};
