// src/db/csv_import.rs

use std::path::Path;
use std::fs::File;
use std::io::{Read, BufReader};
use csv::{Reader, StringRecord};
use uuid::Uuid;
use rusqlite::{Connection, params};
use serde::{Serialize, Deserialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ExistingAccountInfo {
    pub existing_id: String,
    pub school_id: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub row_number: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SerializableStringRecord {
    pub values: Vec<String>
}

impl From<StringRecord> for SerializableStringRecord {
    fn from(record: StringRecord) -> Self {
        SerializableStringRecord {
            values: record.iter().map(|s| s.to_string()).collect()
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CsvValidationResult {
    pub is_valid: bool,
    pub file_name: String,
    pub file_size: usize,
    pub total_rows: usize,
    pub validated_rows: usize,
    pub invalid_rows: usize,
    pub encoding: String,
    pub preview_rows: Vec<SerializableStringRecord>,
    pub validation_errors: Vec<ValidationError>,
    pub errors: Vec<ValidationError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationError {
    pub row_number: usize,
    pub field: Option<String>,
    pub error_type: ValidationErrorType,
    pub error_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ValidationErrorType {
    FileSize,
    FileType,
    Encoding,
    HeaderMissing,
    DataIntegrity,
    TypeMismatch,
}

pub struct CsvValidator {
    max_file_size: usize,  // bytes
    required_headers: Vec<String>,
    optional_headers: Vec<String>,
    connection: Connection,
}

impl CsvValidator {
    pub fn new(connection: Connection) -> Self {
        CsvValidator {
            max_file_size: 10 * 1024 * 1024, 
            required_headers: vec![
                "student_id".to_string(),
                "first_name".to_string(),
                "middle_name".to_string(),
                "last_name".to_string(),
            ],
            optional_headers: vec![
                "gender".to_string(),
                "course".to_string(),
                "department".to_string(),
                "position".to_string(),
                "major".to_string(),
                "year_level".to_string(),
                "is_active".to_string(),
                "last_updated_semester_id".to_string(),
                "last_updated_semester".to_string(),
            ],
            connection,
        }
    }

    pub fn check_existing_school_accounts(&self, headers: &StringRecord, records: &[StringRecord]) -> Vec<ExistingAccountInfo> {
        // Find the index of the school_id column
        let school_id_index = match headers.iter().position(|h| h.to_lowercase() == "student_id") {
            Some(idx) => idx,
            None => return Vec::new(), // If no student_id column, return empty
        };
    
        // Collect all school IDs from the CSV
        let csv_school_ids: Vec<String> = records
            .iter()
            .map(|record| record.get(school_id_index).unwrap_or("").trim().to_string())
            .filter(|id| !id.is_empty())
            .collect();
    
        if csv_school_ids.is_empty() {
            return Vec::new();
        }
    
        // Prepare SQL query to find existing accounts
        let placeholders = csv_school_ids.iter().map(|_| "?").collect::<Vec<&str>>().join(",");
        let query = format!(
            "SELECT id, school_id, first_name, last_name FROM school_accounts WHERE school_id IN ({})", 
            placeholders
        );
    
        // Execute query
        let mut existing_accounts = Vec::new();
        
        // Use match to handle potential query preparation errors
        let stmt_result = self.connection.prepare(&query);
        let mut stmt = match stmt_result {
            Ok(stmt) => stmt,
            Err(_) => return Vec::new(), // Return empty if statement preparation fails
        };
    
        let params: Vec<&dyn rusqlite::ToSql> = csv_school_ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
    
        // Use match to handle potential query errors
        let rows_result = stmt.query(params.as_slice());
        let mut rows = match rows_result {
            Ok(rows) => rows,
            Err(_) => return Vec::new(), // Return empty if query fails
        };
    
        // Iterate through rows
        while let Ok(Some(row)) = rows.next() {
            let existing_id: String = row.get(0).unwrap_or_default();
            let school_id: String = row.get(1).unwrap_or_default();
            let first_name: Option<String> = row.get(2).ok();
            let last_name: Option<String> = row.get(3).ok();
    
            // Find the row number in the original CSV
            let csv_row_number = records
                .iter()
                .position(|record| 
                    record.get(school_id_index)
                        .map(|id| id.trim() == school_id)
                        .unwrap_or(false)
                )
                .map(|idx| idx + 2) // +2 to account for header row and 1-based indexing
                .unwrap_or(0);
    
            existing_accounts.push(ExistingAccountInfo {
                existing_id,
                school_id,
                first_name,
                last_name,
                row_number: csv_row_number,
            });
        }
    
        existing_accounts
    }

    pub fn validate_file(&self, file_path: &Path) -> Result<CsvValidationResult, Vec<ValidationError>> {
        let mut errors = Vec::new();
    
        // File Size and Type Validation
        let file_metadata = std::fs::metadata(file_path)
            .map_err(|_| vec![ValidationError {
                row_number: 0,
                field: None,
                error_type: ValidationErrorType::FileSize,
                error_message: "Unable to read file metadata".to_string(),
            }])?;
    
        if file_metadata.len() > self.max_file_size as u64 {
            errors.push(ValidationError {
                row_number: 0,
                field: None,
                error_type: ValidationErrorType::FileSize,
                error_message: format!("File exceeds maximum size of {} bytes", self.max_file_size),
            });
        }
    
        let extension = file_path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("");
        
        if extension.to_lowercase() != "csv" {
            errors.push(ValidationError {
                row_number: 0,
                field: None,
                error_type: ValidationErrorType::FileType,
                error_message: "Invalid file type. Only .csv files are allowed".to_string(),
            });
        }
    
        // File Reading and Encoding
        let file = File::open(file_path)
            .map_err(|_| vec![ValidationError {
                row_number: 0,
                field: None,
                error_type: ValidationErrorType::Encoding,
                error_message: "Unable to open file".to_string(),
            }])?;
    
        let mut reader = BufReader::new(file);
        let mut buffer = Vec::new();
        
        reader.read_to_end(&mut buffer)
            .map_err(|_| vec![ValidationError {
                row_number: 0,
                field: None,
                error_type: ValidationErrorType::Encoding,
                error_message: "Failed to read file contents".to_string(),
            }])?;
    
        if std::str::from_utf8(&buffer).is_err() {
            errors.push(ValidationError {
                row_number: 0,
                field: None,
                error_type: ValidationErrorType::Encoding,
                error_message: "File is not valid UTF-8".to_string(),
            });
        }
    
        // Create CSV reader
        let mut rdr = Reader::from_reader(std::io::Cursor::new(buffer.clone()));
    
        // Header Validation
        let headers = match rdr.headers() {
            Ok(headers) => headers.clone(),
            Err(_) => {
                errors.push(ValidationError {
                    row_number: 0,
                    field: None,
                    error_type: ValidationErrorType::HeaderMissing,
                    error_message: "Unable to read CSV headers".to_string(),
                });
                StringRecord::new()
            }
        };
    
        // Validate Headers
        if let Err(header_errors) = self.validate_headers(&headers) {
            errors.extend(header_errors);
        }
    
        // Detailed Row Validation and Preview
        let mut preview_rows = Vec::new();
        let mut total_records = 0;
        let mut valid_records = 0;
        let mut invalid_records = 0;
    
        for (idx, result) in rdr.records().enumerate() {
            total_records += 1;
            match result {
                Ok(record) => {
                    if idx < 5 {
                        preview_rows.push(SerializableStringRecord {
                            values: record.iter().map(|s| s.to_string()).collect()
                        });
                    }
                    
                    match self.validate_record(&record, &headers) {
                        Ok(_) => valid_records += 1,
                        Err(record_errors) => {
                            invalid_records += 1;
                            errors.extend(record_errors);
                        }
                    }
                },
                Err(_) => {
                    invalid_records += 1;
                    errors.push(ValidationError {
                        row_number: total_records,
                        field: None,
                        error_type: ValidationErrorType::DataIntegrity,
                        error_message: "Invalid CSV record".to_string(),
                    });
                }
            }
        }
    
        // Prepare to check existing accounts (without adding them as errors)
        let existing_accounts = if errors.is_empty() {
            let mut rdr = Reader::from_reader(std::io::Cursor::new(buffer.clone()));
            
            // Get headers
            let headers = match rdr.headers() {
                Ok(headers) => headers.clone(),
                Err(_) => StringRecord::new()
            };
    
            // Collect records
            let records: Vec<StringRecord> = rdr.records()
                .filter_map(Result::ok)
                .collect();
    
            // Check for existing accounts (but don't treat as errors)
            self.check_existing_school_accounts(&headers, &records)
        } else {
            Vec::new()
        };
    
        // Create validation result
        let mut validation_result = CsvValidationResult {
            is_valid: errors.is_empty(),
            file_name: file_path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("unknown")
                .to_string(),
            file_size: file_metadata.len() as usize,
            total_rows: total_records,
            validated_rows: valid_records,
            invalid_rows: invalid_records,
            encoding: "UTF-8".to_string(),
            preview_rows,
            validation_errors: errors.clone(),
            errors: errors.clone(),
        };
    
        // Determine validation result
        if validation_result.is_valid {
            Ok(validation_result)
        } else {
            Err(validation_result.errors.clone())
        }
    }

    fn validate_headers(&self, headers: &StringRecord) -> Result<(), Vec<ValidationError>> {
        let header_names: Vec<String> = headers.iter().map(|h| h.to_lowercase()).collect();
        
        let missing_headers: Vec<String> = self.required_headers
            .iter()
            .filter(|&required| !header_names.contains(&required.to_lowercase()))
            .cloned()
            .collect();

        if !missing_headers.is_empty() {
            Err(missing_headers.into_iter().map(|header| ValidationError {
                row_number: 0,
                field: Some(header.clone()),
                error_type: ValidationErrorType::HeaderMissing,
                error_message: format!("Missing required header: {}", header),
            }).collect())
        } else {
            Ok(())
        }
    }

    fn validate_record(&self, record: &StringRecord, headers: &StringRecord) -> Result<(), Vec<ValidationError>> {
        let mut record_errors = Vec::new();
    
        // Validate Required Fields
        let required_validations = [
            ("student_id", "Student ID cannot be empty"),
            ("first_name", "First name cannot be empty"),
            ("middle_name", "Middle name cannot be empty"),
            ("last_name", "Last name cannot be empty"),
        ];
    
        for (header, error_msg) in required_validations.iter() {
            match headers.iter().position(|h| h.to_lowercase() == header.to_lowercase()) {
                Some(idx) => {
                    let value = record.get(idx).unwrap_or("").trim();
                    if value.is_empty() {
                        record_errors.push(ValidationError {
                            row_number: 0, 
                            field: Some(header.to_string()),
                            error_type: ValidationErrorType::DataIntegrity,
                            error_message: error_msg.to_string(),
                        });
                    }
                },
                None => {} // This should be caught by header validation
            }
        }
    
        // Optional Field Validations
        let optional_field_validations: Vec<(&str, Box<dyn Fn(&str) -> bool>)> = vec![
            ("gender", Box::new(|value: &str| -> bool {
                if value.is_empty() { return true; }
                matches!(value.to_lowercase().as_str(), "male" | "female" | "other" | "0" | "1" | "2")
            })),
            ("year_level", Box::new(|value: &str| -> bool {
                if value.is_empty() { return true; }
                // Add any specific year level validations if needed
                true
            })),
            ("is_active", Box::new(|value: &str| -> bool {
                if value.is_empty() { return true; }
                matches!(value, "0" | "1" | "true" | "false")
            })),
            ("last_updated_semester_id", Box::new(|value: &str| -> bool {
                if value.is_empty() { return true; }
                Uuid::parse_str(value).is_ok()
            })),
        ];
    
        for (header, validation_fn) in optional_field_validations.iter() {
            match headers.iter().position(|h| h.to_lowercase() == header.to_lowercase()) {
                Some(idx) => {
                    let value = record.get(idx).unwrap_or("").trim();
                    if !value.is_empty() && !validation_fn(value) {
                        record_errors.push(ValidationError {
                            row_number: 0, 
                            field: Some(header.to_string()),
                            error_type: ValidationErrorType::TypeMismatch,
                            error_message: format!("Invalid value for {}", header),
                        });
                    }
                },
                None => {} // Optional field not present is fine
            }
        }
    
        if record_errors.is_empty() {
            Ok(())
        } else {
            Err(record_errors)
        }
    }
}