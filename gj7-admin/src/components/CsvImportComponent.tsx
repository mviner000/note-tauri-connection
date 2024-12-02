// CsvImportComponent.tsx

import React, { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { CsvImportApi, CsvValidationResult, CsvImportResponse } from '../lib/csv_import';
import { SemesterApi, Semester } from '../lib/semester';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { FileSpreadsheet, AlertCircle, CheckCircle, FileUp, ClipboardCheck, Upload, Check, SquareLibrary, MoveRight } from 'lucide-react';
import { CsvHeaderValidationErrors } from './CsvHeaderValidationErrors';
import CsvContentValidationErrors from './CsvContentValidationErrors';
import { SchoolAccount } from '@/lib/school_accounts';
import ImportLoadingState from './ImportLoadingState';

interface CsvImportComponentProps {
  onImportSuccess: () => void;
}

interface ExistingAccountInfo {
  existing_accounts: SchoolAccount[];
  new_accounts_count: number;
  existing_accounts_count: number;
}

const steps = [
  { id: 'select', label: 'Select File', icon: FileUp },
  { id: 'validate', label: 'Validate', icon: ClipboardCheck },
  { id: 'import', label: 'Import', icon: Upload },
  { id: 'finish', label: 'Finish', icon: Check },
];

export const CsvImportComponent: React.FC<CsvImportComponentProps> = ({ onImportSuccess }) => {
  const [fullFilePath, setFullFilePath] = useState<string | null>(null);
  const [displayFileName, setDisplayFileName] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [validationResult, setValidationResult] = useState<CsvValidationResult | null>(null);
  const [existingAccountInfo, setExistingAccountInfo] = useState<ExistingAccountInfo | null>(null);
  const [importResult, setImportResult] = useState<CsvImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUpdateConfirmation, setShowUpdateConfirmation] = useState(false);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [selectedSemester, setSelectedSemester] = useState<Semester | null>(null);
  const [showStatistics, setShowStatistics] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [showExistingAccountInfo, setShowExistingAccountInfo] = useState(true);
  const [showImportSection, setShowImportSection] = useState(true);
  const [isFileImported, setIsFileImported] = useState(false);
  const [isShowingImportLoadingState, setIsShowingImportLoadingState] = useState(false);

  useEffect(() => {
    const fetchSemesters = async () => {
      try {
        const fetchedSemesters = await SemesterApi.getAllSemesters();
        setSemesters(fetchedSemesters);
      } catch (err) {
        setError('Failed to fetch semesters');
        console.error(err);
      }
    };

    fetchSemesters();
  }, []);

  const handleFileSelect = async () => {
    try {
      // Disable the button if any of these conditions are true
      if (isFileImported || existingAccountInfo || showStatistics) {
        return;
      }

      const selected = await open({
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        multiple: false,
        directory: false
      });

      if (selected) {
        setFullFilePath(selected);
        setDisplayFileName(selected.split(/[\\/]/).pop() || selected);
        resetState();
        setCurrentStep(1);
      }
    } catch (err) {
      setError('Failed to select file');
      console.error(err);
    }
  };

  const resetState = () => {
    setError(null);
    setValidationResult(null);
    setImportResult(null);
    setSelectedSemester(null);
    setExistingAccountInfo(null);
    setShowUpdateConfirmation(false);
    setShowStatistics(false);
    setCurrentStep(0);
    setShowExistingAccountInfo(true);
    setShowImportSection(true);
    setIsFileImported(false);
  };

  const validateFile = async () => {
    if (!fullFilePath) {
      setError('Please select a file first');
      return;
    }
  
    setIsValidating(true);
    setError(null);
  
    try {
      const result = await CsvImportApi.validateCsvFile(fullFilePath);
      setValidationResult(result);
      
      const accountInfo = await CsvImportApi.checkExistingAccounts(fullFilePath);
      setExistingAccountInfo(accountInfo);
      setCurrentStep(2);
    } catch (err) {
      console.error('Validation error:', err);
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setIsValidating(false);
    }
  };

  const importFile = async (forceUpdate: boolean = false) => {
    if (!fullFilePath || !selectedSemester) {
      setError('Please select both a file and semester');
      return;
    }

    setIsImporting(true);
    setError(null);
    setShowUpdateConfirmation(false);

    try {
      // If it's a forced update, show the loading state
      if (forceUpdate) {
        setIsShowingImportLoadingState(true);
      }

      const result = await CsvImportApi.importCsvFile({
        file_path: fullFilePath,
        semester_id: selectedSemester.id,
        force_update: forceUpdate
      });
      
      // Hide loading state after import is complete
      setIsShowingImportLoadingState(false);
      
      setImportResult(result);
      setShowStatistics(true);
      setCurrentStep(3);
      setIsFileImported(true);

      return result;
    } catch (err) {
      // Hide loading state in case of error
      setIsShowingImportLoadingState(false);
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportClick = () => {
    const existingAccountCount = existingAccountInfo?.existing_accounts_count ?? 0;
      
    if (existingAccountCount > 0) {
      setShowUpdateConfirmation(true);
    } else {
      importFile(false);
    }
  };

  const handleFinish = () => {
    onImportSuccess();
  };

  const shouldShowCancelButton = (fullFilePath || isFileImported || existingAccountInfo) && !showStatistics;

  return (
    <Card className="w-full max-w-4xl">
      {isShowingImportLoadingState ? (
        <ImportLoadingState />
      ) : (
        <>
      <CardHeader>
        <div className="flex justify-between items-center w-full">
          <div className="flex items-center">
            <FileSpreadsheet className="mr-2" />
            <CardTitle>CSV Import</CardTitle>
          </div>
          {shouldShowCancelButton && (
            <Button 
              variant="outline" 
              className="border-red-500 text-red-500 hover:bg-red-50"
              onClick={() => {
                resetState();
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </CardHeader>
      </>
    )}
      {currentStep > 0 && !isShowingImportLoadingState && (
        <div className="px-6 py-2">
          <Progress value={(currentStep / steps.length) * 100} className="w-full" />
          <div className="flex justify-between mt-2">
            {steps.map((step, index) => (
              <div key={step.id} className={`flex flex-col items-center ${index < currentStep ? 'text-green-500' : 'text-gray-400'}`}>
                <step.icon className="w-6 h-6" />
                <span className="text-xs mt-1">{step.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <CardContent>
        <div className="space-y-4">
          <div className="flex space-x-4">
            <Button
              onClick={handleFileSelect} 
              variant="outline" 
              className="flex-grow border-green-500 hover:bg-green-50"
              disabled={isFileImported || !!existingAccountInfo || showStatistics}
            >
              <FileUp className="w-4 h-4 mr-2" />
              {displayFileName ? `Selected: ${displayFileName}` : 'Select CSV File'}
            </Button>
          </div>

          {fullFilePath && !isFileImported && !existingAccountInfo && (
            <div className="flex justify-end items-center">
              <Button 
                onClick={validateFile} 
                disabled={!fullFilePath || isValidating}
                className={`flex items-center justify-center gap-2 pl-4 border border-yellow-700 pr-5 py-3 text-white font-semibold transition duration-200 ease-in-out ${
                  isValidating || !fullFilePath ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-500 hover:bg-green-600 active:scale-95'
                }`}
              >
                <MoveRight className="w-5 h-5" />
                <span className='mt-1 text-base'>
                  {isValidating ? 'Validating...' : 'Validate File'}
                </span>
              </Button>
            </div>
          )}

          {existingAccountInfo && showExistingAccountInfo && 
          validationResult && 
          !validationResult.validation_errors.some(err => err.row_number === 0) && (
            <Alert variant="default" className="border-green-500 pb-4">
              <div className="flex items-center space-x-2 mb-1">
                <SquareLibrary className="h-6 w-6 text-green-600" />
                <AlertTitle className="text-2xl font-black text-green-600 mt-3">Validated CSV File</AlertTitle>
              </div>
              <AlertDescription className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-green-50 rounded-lg p-4 border border-green-100">
                    <div className="text-base text-green-600 font-bold mb-1">New Accounts</div>
                    <div className='py-3 mt-2'>
                      <span className="text-4xl font-bold text-white py-4 px-2 pb-1.5 bg-green-500 rounded-md">
                        {existingAccountInfo.new_accounts_count}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 italic">To be created</div>
                  </div>
                  
                  <div className="bg-green-50 rounded-lg p-4 border border-green-100">
                    <div className="text-base text-green-700 font-bold mb-1 underline underline-offset-1">Existing Accounts!</div>
                    <div className='py-3 mt-2'>
                      <span className="text-4xl font-bold text-white py-4 px-2 pb-1.5 bg-green-500 rounded-md">
                        {existingAccountInfo.existing_accounts_count}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 italic">To be updated</div>
                  </div>
                </div>

                {existingAccountInfo.existing_accounts.length > 0 && (
                  <div className="mt-4 bg-green-50 rounded-lg p-4 border border-green-200">
                    <p className="text-sm font-semibold text-green-700 mb-2">Accounts to be updated:</p>
                    <ul className="space-y-1">
                      {existingAccountInfo.existing_accounts.slice(0, 5).map((account, index) => (
                        <li key={index} className="text-sm text-gray-600 flex items-center">
                          <div className="w-2 h-2 bg-green-600 rounded-full mr-2"></div>
                          <span className="font-medium">{account.school_id}</span>
                          <span className="mx-2">-</span>
                          <span>{account.first_name} {account.last_name}</span>
                        </li>
                      ))}
                      {existingAccountInfo.existing_accounts.length > 5 && (
                        <li className="text-xs text-gray-500 italic mt-2 pl-4">
                          ... and {existingAccountInfo.existing_accounts.length - 5} more accounts
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {validationResult?.is_valid && showImportSection && (
            <>
              <div className="space-y-2">
                <Select 
                  value={selectedSemester?.id} 
                  onValueChange={(selectedId) => {
                    const semester = semesters.find(s => s.id === selectedId);
                    setSelectedSemester(semester || null);
                  }}
                >
                  <SelectTrigger className="bg-black text-slate-200">
                    <SelectValue placeholder="Select Semester" />
                  </SelectTrigger>
                  <SelectContent>
                    {semesters.map(semester => (
                      <SelectItem key={semester.id} value={semester.id}>
                        {semester.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedSemester && (
                <Button 
                  onClick={handleImportClick} 
                  disabled={isImporting}
                  variant="default"
                  className="w-full"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {isImporting ? 'Importing...' : 'Import File'}
                </Button>
              )}
            </>
          )}

          {validationResult && !validationResult.is_valid && (
            <>
              {validationResult.validation_errors.some(err => err.row_number === 0) && (
                <CsvHeaderValidationErrors errors={validationResult.validation_errors} />
              )}
              {validationResult.validation_errors.some(err => err.row_number > 0) && (
                <CsvContentValidationErrors errors={validationResult.validation_errors} />
              )}
            </>
          )}

          {showStatistics && importResult && importResult.account_status_counts && (
            <Alert variant="default" className="bg-green-50 border-green-300 p-4">
              <div className="flex items-center space-x-4 mb-4">
                <CheckCircle className="h-10 w-10 text-green-600" />
                <AlertTitle className="text-2xl font-bold text-green-800 mt-2">Import Successful</AlertTitle>
              </div>
              <AlertDescription>
                <div className="space-y-4">
                  {importResult.existing_account_info && (
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div className="bg-blue-100 p-3 rounded-lg">
                        <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">New Accounts</p>
                        <p className="text-lg font-bold text-blue-800">{importResult.existing_account_info.new_accounts_count}</p>
                      </div>
                      <div className="bg-yellow-100 p-3 rounded-lg">
                        <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Updated Accounts</p>
                        <p className="text-lg font-bold text-yellow-800">{importResult.existing_account_info.existing_accounts_count}</p>
                      </div>
                      <div className="bg-purple-100 p-3 rounded-lg">
                        <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Total in Database</p>
                        <p className="text-lg font-bold text-purple-800">{importResult.account_status_counts.total_accounts}</p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-green-200 p-3 rounded-lg">
                      <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Activated Accounts</p>
                      <p className="text-lg font-bold text-green-900">{importResult.account_status_counts.activated_accounts}</p>
                    </div>
                    <div className="bg-red-200 p-3 rounded-lg">
                      <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Deactivated Accounts</p>
                      <p className="text-lg font-bold text-red-900">{importResult.account_status_counts.deactivated_accounts}</p>
                    </div>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {importResult && importResult.failed_imports > 0 && (
            <Alert variant="destructive" className="bg-red-50 border-red-300">
              <div className="flex items-center">
                <AlertCircle className="h-8 w-8 text-red-600 mr-4" />
                <div>
                  <AlertTitle className="text-xl font-bold text-red-800 mb-2">Import Completed with Partial Errors</AlertTitle>
                  <AlertDescription>
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <div className="bg-red-100 p-2 rounded">
                          <p className="text-xs text-gray-600 uppercase tracking-wider">Total Processed</p>
                          <p className="text-lg font-semibold text-red-700">{importResult.total_processed}</p>
                        </div>
                        <div className="bg-green-100 p-2 rounded">
                          <p className="text-xs text-gray-600 uppercase tracking-wider">Successfully Imported</p>
                          <p className="text-lg font-semibold text-green-700">{importResult.successful_imports}</p>
                        </div>
                        <div className="bg-red-200 p-2 rounded">
                          <p className="text-xs text-gray-600 uppercase tracking-wider">Failed Imports</p>
                          <p className="text-lg font-semibold text-red-800">{importResult.failed_imports}</p>
                        </div>
                      </div>
                      
                      <div className="bg-red-100 p-3 rounded-lg">
                        <p className="font-bold text-red-800 mb-2 text-sm">Error Details:</p>
                        <ul className="space-y-1 text-xs text-red-700">
                          {importResult.error_details.slice(0, 5).map((err, index) => (
                            <li key={index} className="flex items-center">
                              <AlertCircle className="w-3 h-3 mr-2 text-red-500" />
                              {err}
                            </li>
                          ))}
                          {importResult.error_details.length > 5 && (
                            <li className="text-gray-600 italic">
                              ... and {importResult.error_details.length - 5} more errors
                            </li>
                          )}
                        </ul>
                      </div>
                    </div>
                  </AlertDescription>
                </div>
              </div>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {currentStep === 3 && importResult && importResult.failed_imports === 0 && (
            <Button 
              onClick={handleFinish}
              variant="default"
              className="w-full"
            >
              <Check className="w-4 h-4 mr-2" />
              Finish
            </Button>
          )}

          <Dialog open={showUpdateConfirmation} onOpenChange={setShowUpdateConfirmation}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm Update</DialogTitle>
                <DialogDescription className="space-y-2">
                  <p>You are about to:</p>
                  <ul className="list-disc list-inside">
                    <li>Update {existingAccountInfo?.existing_accounts_count} existing accounts</li>
                    <li>Create {existingAccountInfo?.new_accounts_count} new accounts</li>
                  </ul>
                  <p className="font-semibold text-red-500">This action cannot be undone.</p>
                  <p>Do you want to continue?</p>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex space-x-2">
                <Button
                  variant="outline"
                  onClick={() => setShowUpdateConfirmation(false)}
                  className="border-green-500 hover:bg-green-50"
                >
                  Cancel
                </Button>
                <Button
                  variant="default"
                  onClick={async () => {
                    setShowExistingAccountInfo(false);
                    setShowImportSection(false);
                    const result = await importFile(true);
                    if (result && result.failed_imports === 0) {
                      setShowStatistics(true);
                      setShowUpdateConfirmation(false);
                    }
                  }}
                >
                  Continue with Update
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
};

export default CsvImportComponent;
