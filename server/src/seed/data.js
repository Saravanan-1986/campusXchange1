/**
 * Demo seeder — run: npm run seed  (from /server)
 * Creates: admin + students, geo-tagged resources, materials, reviews,
 * transactions (one overdue lend), availability requests, history + graph sync.
 * Idempotent: wipes existing collections first.
 *
 * SEED LOGIN (password for everyone): Passw0rd!
 *   admin@campusxchange.edu      (admin)
 *   aisha@campusxchange.edu      (student)
 *   rohan@campusxchange.edu      (student)
 *   meera@campusxchange.edu      (student)
 */
import mongoose from 'mongoose';
import User from '../models/User.js';
import Resource from '../models/Resource.js';
import StudyMaterial from '../models/StudyMaterial.js';
import Transaction from '../models/Transaction.js';
import Review from '../models/Review.js';
import RequestModel from '../models/Request.js';
import ResourceHistory from '../models/ResourceHistory.js';
import Notification from '../models/Notification.js';
import DbEvent from '../models/DbEvent.js';
import Report from '../models/Report.js';
import { env } from '../config/env.js';
import { connectDatabase } from '../config/db.js';
import { recordResourceState } from '../services/history.service.js';
import { syncResourceToGraph, syncReviewToGraph, syncUsedToGraph } from '../services/graph.service.js';

// Campus geo-center (edit to your college's coordinates)
const CAMPUS = { lng: 77.5946, lat: 12.9716, label: 'Main Campus Block A' };

const USERS = [
  { name: 'Campus Admin', collegeEmail: 'admin@campusxchange.edu', role: 'admin', department: 'Administration', semester: 1, gradYear: '2027', verified: true },
  { name: 'Aisha Sharma', collegeEmail: 'aisha@campusxchange.edu', role: 'student', department: 'Computer Science', semester: 5, gradYear: '2027', verified: true },
  { name: 'Rohan Verma', collegeEmail: 'rohan@campusxchange.edu', role: 'student', department: 'Electronics', semester: 7, gradYear: '2026', verified: true },
  { name: 'Meera Iyer', collegeEmail: 'meera@campusxchange.edu', role: 'student', department: 'Computer Science', semester: 3, gradYear: '2028', verified: true },
];

const RESOURCES = [
  { title: 'Operating Systems — Galvin (9th Ed)', category: 'textbook', subject: 'Operating Systems', department: 'Computer Science', semester: 5, condition: 'like-new', listingType: 'sell', price: 350, tags: ['os', 'book', 'cse'], owner: 1 },
  { title: 'Casio FX-991EX Scientific Calculator', category: 'calculator', subject: 'Mathematics', department: 'General', semester: 3, condition: 'good', listingType: 'sell', price: 550, tags: ['calc', 'math'], owner: 2 },
  { title: 'Digital Electronics Lab Kit', category: 'lab-kit', subject: 'Digital Electronics', department: 'Electronics', semester: 4, condition: 'good', listingType: 'lend', price: 0, tags: ['lab', 'ece', 'kit'], owner: 1 },
  { title: 'Arduino UNO R3 Starter Bundle', category: 'electronic-component', subject: 'Embedded Systems', department: 'Electronics', semester: 6, condition: 'new', listingType: 'sell', price: 900, tags: ['arduino', 'iot'], owner: 2 },
  { title: 'Soldering Station (Weller, 60W)', category: 'tool', subject: 'Workshop', department: 'Electronics', semester: 4, condition: 'good', listingType: 'lend', price: 0, tags: ['tool', 'workshop'], owner: 1 },
  { title: 'DBMS Concepts — Korth (7th Ed)', category: 'textbook', subject: 'Database Systems', department: 'Computer Science', semester: 5, condition: 'fair', listingType: 'exchange', price: 0, tags: ['dbms', 'book', 'sql'], owner: 2 },
  { title: 'Mechanics Lab Measurement Kit', category: 'lab-kit', subject: 'Physics', department: 'Applied Sciences', semester: 2, condition: 'good', listingType: 'sell', price: 400, tags: ['physics', 'lab'], owner: 3 },
  { title: 'Final Year Project — Smart Energy Monitor', category: 'project-resource', subject: 'IoT', department: 'Electronics', semester: 8, condition: 'good', listingType: 'donate', price: 0, tags: ['project', 'energy', 'iot'], owner: 1 },
  { title: 'Data Structures — Tanenbaum Notes Set', category: 'textbook', subject: 'Data Structures', department: 'Computer Science', semester: 3, condition: 'like-new', listingType: 'sell', price: 220, tags: ['dsa', 'book'], owner: 3 },
  { title: 'Multimeter (Auto-range, TRMS)', category: 'tool', subject: 'Electrical Lab', department: 'Electronics', semester: 4, condition: 'new', listingType: 'sell', price: 750, tags: ['multimeter', 'tool'], owner: 2 },
  { title: 'Signal Processing Dev Board (DSP)', category: 'electronic-component', subject: 'Signals', department: 'Electronics', semester: 6, condition: 'good', listingType: 'exchange', price: 0, tags: ['dsp', 'board'], owner: 3 },
  { title: 'Graph Theory — Deo (Reference)', category: 'textbook', subject: 'Discrete Math', department: 'Computer Science', semester: 3, condition: 'good', listingType: 'sell', price: 180, tags: ['math', 'graph'], owner: 1 },
];

const MATERIALS = [
  { title: 'DBMS Full Unit 1-5 Notes (handwritten)', type: 'notes', department: 'Computer Science', semester: 5, subject: 'Database Systems', description: 'Normalization, ER modeling, SQL, transactions — viva-ready.' },
  { title: 'OS Endsem Question Papers 2019-2024', type: 'question-paper', department: 'Computer Science', semester: 5, subject: 'Operating Systems', description: 'Six years of papers with marking scheme.' },
  { title: 'Digital Electronics Lab Manual', type: 'lab-manual', department: 'Electronics', semester: 4, subject: 'Digital Electronics', description: 'All 12 experiments with breadboard layouts.' },
  { title: 'IoT Mini-Project Report Template', type: 'project-reference', department: 'Electronics', semester: 8, subject: 'IoT', description: 'Format, rubric and sample abstract.' },
];

export { USERS, RESOURCES, MATERIALS, CAMPUS };
