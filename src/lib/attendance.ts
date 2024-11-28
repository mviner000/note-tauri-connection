// lib/attendance.ts

import { invoke } from '@tauri-apps/api/core';
import { logger } from './logger';
import { v4 as uuidv4 } from 'uuid';

// Types from Rust implementation
export interface Attendance {
  id: string;  // UUID as string
  school_id: string;
  full_name: string;
  time_in_date: string;  // DateTime<Utc> as string
  classification: string;
  purpose_id?: string;  // Optional UUID as string
}

export interface AttendanceWithDates {
  id: string;
  school_id: string;
  full_name: string;
  time_in_date: Date;
  classification: string;
  purpose_id?: string;
}

export interface CreateAttendanceRequest {
  school_id: string;
  full_name: string;
  classification: string;
  purpose_id?: string;
}

export interface UpdateAttendanceRequest {
  school_id?: string;
  full_name?: string;
  classification?: string;
  purpose_id?: string;
}

export interface Credentials {
  username: string;
  password: string;
}

function convertToDateAttendance(attendance: Attendance): AttendanceWithDates {
  return {
    ...attendance,
    time_in_date: new Date(attendance.time_in_date)
  };
}

export const AttendanceApi = {
  async getCredentials(): Promise<Credentials> {
    try {
      logger.log('Fetching credentials', 'info');
      const credentials = await invoke('get_credentials');
      return credentials as Credentials;
    } catch (error) {
      logger.log(`Failed to fetch credentials: ${error}`, 'error');
      throw error;
    }
  },

  async createAttendance(
    attendance: CreateAttendanceRequest, 
    username: string, 
    password: string
  ): Promise<AttendanceWithDates> {
    try {
      logger.log(`Creating new attendance for: ${attendance.full_name}`, 'info');
      const result = await invoke('create_attendance', { attendance, username, password });
      logger.log(`Successfully created attendance for: ${attendance.full_name}`, 'success');
      return convertToDateAttendance(result as Attendance);
    } catch (error) {
      logger.log(`Failed to create attendance: ${error}`, 'error');
      throw error;
    }
  },

  async getAllAttendances(): Promise<AttendanceWithDates[]> {
    try {
      logger.log('Fetching all attendances', 'info');
      const attendances = await invoke('get_all_attendances');
      logger.log(`Successfully fetched ${(attendances as Attendance[]).length} attendances`, 'success');
      return (attendances as Attendance[]).map(convertToDateAttendance);
    } catch (error) {
      logger.log(`Failed to fetch attendances: ${error}`, 'error');
      throw error;
    }
  },

  async getAttendance(id: string): Promise<AttendanceWithDates> {
    try {
      logger.log(`Fetching attendance with id: ${id}`, 'info');
      const result = await invoke('get_attendance', { id });
      logger.log(`Successfully fetched attendance for: ${(result as Attendance).full_name}`, 'success');
      return convertToDateAttendance(result as Attendance);
    } catch (error) {
      logger.log(`Failed to fetch attendance ${id}: ${error}`, 'error');
      throw error;
    }
  },

  async updateAttendance(
    id: string, 
    attendance: UpdateAttendanceRequest, 
    username: string, 
    password: string
  ): Promise<AttendanceWithDates> {
    try {
      logger.log(`Updating attendance ${id}`, 'info');
      const result = await invoke('update_attendance', { id, attendance, username, password });
      logger.log(`Successfully updated attendance ${id}`, 'success');
      return convertToDateAttendance(result as Attendance);
    } catch (error) {
      logger.log(`Failed to update attendance ${id}: ${error}`, 'error');
      throw error;
    }
  },

  async deleteAttendance(
    id: string, 
    username: string, 
    password: string
  ): Promise<void> {
    try {
      logger.log(`Deleting attendance ${id}`, 'info');
      await invoke('delete_attendance', { id, username, password });
      logger.log(`Successfully deleted attendance ${id}`, 'success');
    } catch (error) {
      logger.log(`Failed to delete attendance ${id}: ${error}`, 'error');
      throw error;
    }
  },

  async getAttendancesBySemester(semester_id: string): Promise<AttendanceWithDates[]> {
    try {
      logger.log(`Fetching attendances for semester: ${semester_id}`, 'info');
      const attendances = await invoke('get_attendances_by_semester', { semester_id });
      logger.log(`Successfully fetched ${(attendances as Attendance[]).length} attendances for semester`, 'success');
      return (attendances as Attendance[]).map(convertToDateAttendance);
    } catch (error) {
      logger.log(`Failed to fetch attendances for semester: ${error}`, 'error');
      throw error;
    }
  },

  async getAttendancesBySchoolAccount(school_account_id: string): Promise<AttendanceWithDates[]> {
    try {
      logger.log(`Fetching attendances for school account: ${school_account_id}`, 'info');
      const attendances = await invoke('get_attendances_by_school_account', { school_account_id });
      logger.log(`Successfully fetched ${(attendances as Attendance[]).length} attendances for school account`, 'success');
      return (attendances as Attendance[]).map(convertToDateAttendance);
    } catch (error) {
      logger.log(`Failed to fetch attendances for school account: ${error}`, 'error');
      throw error;
    }
  }
};