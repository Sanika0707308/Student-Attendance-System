from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List

from database import get_db, Student

router = APIRouter(prefix="/api/students", tags=["Students"])

# Pydantic models for validation
class StudentCreate(BaseModel):
    name: str
    zk_id: str
    parent_email: str
    standard: str = "11th"

class StudentRead(StudentCreate):
    id: int

    class Config:
        from_attributes = True

@router.get("/", response_model=List[StudentRead])
def get_students(standard: str = None, skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    query = db.query(Student)
    if standard:
        query = query.filter(Student.standard == standard)
    students = query.offset(skip).limit(limit).all()
    return students

@router.post("/", response_model=StudentRead)
def create_student(student: StudentCreate, db: Session = Depends(get_db)):
    db_student = db.query(Student).filter(Student.zk_id == student.zk_id).first()
    if db_student:
        raise HTTPException(status_code=400, detail="Student with this ZKTeco ID already registered")
    
    new_student = Student(
        name=student.name,
        zk_id=student.zk_id,
        parent_email=student.parent_email,
        standard=student.standard
    )
    db.add(new_student)
    db.commit()
    db.refresh(new_student)
    return new_student

@router.delete("/{student_id}")
def delete_student(student_id: int, db: Session = Depends(get_db)):
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    
    db.delete(student)
    db.commit()
    return {"message": "Student deleted"}

@router.put("/{student_id}", response_model=StudentRead)
def update_student(student_id: int, student_data: StudentCreate, db: Session = Depends(get_db)):
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    
    # Check if the new ZK ID belongs to someone else
    if student_data.zk_id != student.zk_id:
        duplicate = db.query(Student).filter(Student.zk_id == student_data.zk_id).first()
        if duplicate:
            raise HTTPException(status_code=400, detail="ZKTeco ID already in use")

    student.name = student_data.name
    student.zk_id = student_data.zk_id
    student.parent_email = student_data.parent_email
    student.standard = student_data.standard

    db.commit()
    db.refresh(student)
    return student
