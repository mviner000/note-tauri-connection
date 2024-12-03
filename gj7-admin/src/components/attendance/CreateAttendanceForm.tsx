// components/attendance/AttendanceList.tsx

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { CreateAttendanceRequest } from '@/lib/attendance'
import { Purpose, PurposeApi } from '@/lib/purpose'
import PurposeCard from '@/components/purpose/PurposeCard'

interface CreateAttendanceFormProps {
  onCreateAttendance: (attendance: CreateAttendanceRequest) => Promise<void>
}

const CreateAttendanceForm: React.FC<CreateAttendanceFormProps> = ({ onCreateAttendance }) => {
  const [schoolId, setSchoolId] = useState('')
  const [selectedPurpose, setSelectedPurpose] = useState<Purpose | null>(null)
  const [purposes, setPurposes] = useState<Purpose[]>([])
  const [loading, setLoading] = useState(false)

  // Fetch purposes when component mounts
  useEffect(() => {
    const fetchPurposes = async () => {
      try {
        setLoading(true)
        const fetchedPurposes = await PurposeApi.getAllPurposes()
        // Filter out deleted purposes
        setPurposes(fetchedPurposes.filter(purpose => !purpose.is_deleted))
      } catch (error) {
        console.error('Failed to fetch purposes:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchPurposes()
  }, [])

  const handlePurposeSelect = (purpose: Purpose) => {
    setSelectedPurpose(purpose)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedSchoolId = schoolId.trim()
    
    if (!trimmedSchoolId) {
      console.error('School ID is required')
      return
    }

    // Ensure a purpose is selected
    if (!selectedPurpose) {
      console.error('Please select a purpose')
      return
    }

    const attendanceData: CreateAttendanceRequest = {
      school_id: trimmedSchoolId,
      full_name: '', // Optional, will be filled by backend
      classification: '', // Will be automatically determined by backend
      purpose_label: selectedPurpose.label  // Changed from purpose_id to purpose_label
    }

    await onCreateAttendance(attendanceData)
    
    // Reset form
    setSchoolId('')
    setSelectedPurpose(null)
  }

  return (
    <Card className="mb-6">
      {/* <CardHeader>
        <CardTitle>Create Attendance</CardTitle>
      </CardHeader> */}
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <Input
            type="text"
            placeholder="School ID"
            value={schoolId}
            onChange={(e) => setSchoolId(e.target.value)}
            required
            className='hidden'
          />
          
          <div>
            <h3 className="text-sm font-medium mb-2">Purposes</h3>
            {loading ? (
              <p>Loading purposes...</p>
            ) : purposes.length === 0 ? (
              <p className="text-muted-foreground">No purposes available</p>
            ) : (
              <ScrollArea className="h-[200px] w-full">
                <div className="grid grid-cols-3 gap-4 pr-4">
                  {purposes.map((purpose) => (
                    <PurposeCard
                      key={purpose.id}
                      label={purpose.label}
                      iconName={purpose.icon_name}
                      className={`${
                        selectedPurpose?.label === purpose.label 
                          ? 'border-blue-500 shadow-md bg-blue-50' 
                          : ''
                      }`}
                      onClick={() => handlePurposeSelect(purpose)}
                    />
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex justify-end items-end hidden">
            <Button 
                type="submit" 
                disabled={!schoolId || !selectedPurpose}
            >
                Create Attendance
            </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

export default CreateAttendanceForm