require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const DonationService = require('./services/DonationService');
const Donation = require('./models/Donation');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.socket.io", "cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      mediaSrc: ["'self'", "data:"]
    }
  }
}));

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 นาที
  max: 100, // จำกัด 100 requests ต่อ 15 นาที
  message: 'Too many requests, please try again later.'
});
app.use('/api/', limiter);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static('public'));

// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/easydonation', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});

// Services
const donationService = new DonationService(io);

// Routes
app.get('/', async (req, res) => {
  try {
    const recentDonations = await donationService.getRecentDonations(5);
    const stats = await donationService.getDonationStats();
    
    res.render('index', { 
      recentDonations, 
      stats,
      pageTitle: 'Easy Donate'
    });
  } catch (error) {
    console.error('Error loading home page:', error);
    res.render('index', { 
      recentDonations: [], 
      stats: { totalAmount: 0, totalDonations: 0 },
      pageTitle: 'Easy Donate'
    });
  }
});

app.get('/display', async (req, res) => {
  try {
    const recentDonations = await donationService.getRecentDonations(10);
    const stats = await donationService.getDonationStats();
    
    res.render('display', { 
      recentDonations, 
      stats,
      pageTitle: 'Donation Display'
    });
  } catch (error) {
    console.error('Error loading display page:', error);
    res.render('display', { 
      recentDonations: [], 
      stats: { totalAmount: 0, totalDonations: 0 },
      pageTitle: 'Donation Display'
    });
  }
});

app.get('/overlay', (req, res) => {
  res.render('overlay', { 
    pageTitle: 'Donation Overlay'
  });
});

// API Routes
app.post('/api/donate', async (req, res) => {
  try {
    const { voucherLink, donorName, message } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;

    // Validation
    if (!voucherLink || !donorName) {
      return res.status(400).json({
        success: false,
        message: 'กรุณากรอกลิงก์ซองอังเปาและชื่อผู้บริจาค'
      });
    }

    if (donorName.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'ชื่อผู้บริจาคยาวเกินไป (สูงสุด 100 ตัวอักษร)'
      });
    }

    if (message && message.length > 500) {
      return res.status(400).json({
        success: false,
        message: 'ข้อความยาวเกินไป (สูงสุด 500 ตัวอักษร)'
      });
    }

    const result = await donationService.processDonation({
      voucherLink: voucherLink.trim(),
      donorName: donorName.trim(),
      message: message ? message.trim() : '',
      ipAddress
    });

    res.json(result);

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดภายในระบบ'
    });
  }
});

app.get('/api/donations', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const donations = await donationService.getRecentDonations(limit);
    res.json({ success: true, data: donations });
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await donationService.getDonationStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('👤 Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('👋 Client disconnected:', socket.id);
  });
});

// Error handling
app.use((req, res, next) => {
    res.status(404).json({
        success: false,
        message: 'หน้าไม่พบ',
        error: '404 Not Found'
    });
});

app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(err.status || 500).json({
        success: false,
        message: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์',
        error: process.env.NODE_ENV === 'development' ? err.message : 'Internal Server Error'
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Donation page: http://localhost:${PORT}`);
  console.log(`📺 Display page: http://localhost:${PORT}/display`);
});