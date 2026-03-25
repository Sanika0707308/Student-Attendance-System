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

class StudentRead(StudentCreate):
    id: int

    class Config:
        from_attributes = True

@router.get("/", response_model=List[StudentRead])
def get_students(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    students = db.query(Student).offset(skip).limit(limit).all()
    return students

@router.post("/", response_model=StudentRead)
def create_student(student: StudentCreate, db: Session = Depends(get_db)):
    db_student = db.query(Student).filter(Student.zk_id == student.zk_id).first()
    if db_student:
        raise HTTPException(status_code=400, detail="Student with this ZKTeco ID already registered")
    
    new_student = Student(
        name=student.name,
        zk_id=student.zk_id,
        parent_email=student.parent_email
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
