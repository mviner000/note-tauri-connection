import React, { useState, useCallback, useEffect } from 'react';
import { useAttendanceWebSocket } from '@/utils/websocket';
import { AttendanceApi, UpdateAttendanceRequest } from '@/lib/attendance';
import { LogLevel } from '@/lib/logger';
import { downloadAttendanceTableAsPDF } from '@/utils/pdfUtils';
import { ToastProvider, ToastViewport } from "@/components/ui/toast";
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import AuthModal from '../AuthModal';
import AttendanceCard from '../attendance/AttendanceCard';
import AttendanceTable from '../attendance/AttendanceTable';
import SearchBar from '../SearchBar';
import ViewToggle from '../ViewToggle';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { AttendanceWithDates, convertToAttendanceWithDates } from '@/types/attendance';
import FilteredAttendanceTable from '../FilteredAttendanceTable';

const AttendanceRecordsRealtime: React.FC = () => {
  const { attendances: rawAttendances, isConnected, sendAttendance } = useAttendanceWebSocket();
  const attendances = rawAttendances.map(convertToAttendanceWithDates);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authAction, setAuthAction] = useState<'create' | 'delete'>('create');
  const [credentials, _setCredentials] = useState<{ username: string; password: string }>({ 
    username: 'admin', 
    password: 'your_password' 
  });
  const [attendanceToDelete, setAttendanceToDelete] = useState<string | null>(null);
  const [view, setView] = useState<'card' | 'table'>('card');

  const { toast } = useToast();

  const addToast = useCallback((message: string, level: LogLevel) => {
    toast({
      title: level.charAt(0).toUpperCase() + level.slice(1),
      description: message,
      variant: level === 'error' ? 'destructive' : 'default',
    });
  }, [toast]);

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchStatus(null);
  };

  useEffect(() => {
    console.log('WebSocket Connection Status Changed:', isConnected);
  }, [isConnected]);

  const handleAuthSubmit = async (inputCredentials: { username: string; password: string }) => {
    try {
      if (inputCredentials.username === credentials.username && 
          inputCredentials.password === credentials.password) {
        setIsAuthModalOpen(false);
        if (authAction === 'create') {
          sendAttendance({
            school_id: 'test',
            full_name: 'Test User',
            classification: 'Student'
          });
        } else if (authAction === 'delete' && attendanceToDelete) {
          await deleteAttendance(attendanceToDelete, inputCredentials);
        }
      } else {
        addToast('Invalid credentials', 'error');
      }
    } catch (err) {
      addToast('Authentication failed', 'error');
    }
  };

  const handleUpdateAttendance = async (attendanceId: string, updatedAttendance: UpdateAttendanceRequest) => {
    try {
      await AttendanceApi.updateAttendance(attendanceId, updatedAttendance, credentials.username, credentials.password);
      addToast('Attendance record updated successfully', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update attendance');
      addToast('Failed to update attendance record', 'error');
    }
  };

  const deleteAttendance = async (attendanceId: string, auth: { username: string; password: string }) => {
    try {
      await AttendanceApi.deleteAttendance(attendanceId, auth.username, auth.password);
      addToast('Attendance record deleted successfully', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete attendance');
      addToast('Failed to delete attendance record', 'error');
    } finally {
      setAttendanceToDelete(null);
    }
  };

  const handleDownloadPDF = useCallback(() => {
    if (attendances.length > 0) {
      downloadAttendanceTableAsPDF(attendances as AttendanceWithDates[]);
    } else {
      addToast('No attendance records to download', 'error');
    }
  }, [attendances, addToast]);

  const filteredAttendances: AttendanceWithDates[] = searchQuery
    ? attendances.filter(attendance =>
        attendance.school_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        attendance.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (attendance.purpose_label || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : attendances;

  return (
    <ToastProvider>
      <div className="max-w-screen-xl mx-auto mt-5 mb-5 px-4 sm:px-6 lg:px-0">
      <FilteredAttendanceTable
        initialCourse="BSIT"
        initialDate={new Date()}
      />

        {!isConnected && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Connection Lost</AlertTitle>
            <AlertDescription>
              Attempting to reconnect to real-time updates...
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-end space-x-2 max-w-screen-xl mx-auto mt-5 mb-5 px-4 sm:px-6 lg:px-0">
          <SearchBar
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            handleClearSearch={handleClearSearch}
          />
          <div className='hidden'>
          <ViewToggle
            view={view} 
            onViewChange={setView} 
          />
          </div>
            <Button size="sm" variant="amber3d" onClick={handleDownloadPDF} className="py-[18px]">
              Download Attendance Table in PDF
            </Button>
        </div>

        {searchStatus && (
          <div className="mb-4 text-sm text-muted-foreground">
            {searchStatus}
          </div>
        )}

        {view === 'card' ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredAttendances.map((attendance) => (
              <AttendanceCard
                key={attendance.id}
                attendance={attendance}
                onUpdate={handleUpdateAttendance}
                onDelete={(attendanceId) => {
                  setAttendanceToDelete(attendanceId);
                  setAuthAction('delete');
                  setIsAuthModalOpen(true);
                }}
              />
            ))}
          </div>
        ) : (
          <>
            <AttendanceTable attendances={filteredAttendances} />
          </>
        )}
      </div>
      <ToastViewport />
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSubmit={handleAuthSubmit}
        action={authAction === 'create' ? 'create a new attendance record' : 'delete the attendance record'}
      />
    </ToastProvider>
  );
};

export default AttendanceRecordsRealtime;

