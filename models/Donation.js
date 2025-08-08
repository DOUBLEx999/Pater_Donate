const mongoose = require('mongoose');

const donationSchema = new mongoose.Schema({
  donorName: {
    type: String,
    required: true,
    trim: true,
    maxLength: 100
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  message: {
    type: String,
    trim: true,
    maxLength: 500,
    default: ''
  },
  voucherHash: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  voucherLink: {
    type: String,
    required: true
  },
  ipAddress: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Index สำหรับการค้นหาที่เร็วขึ้น
donationSchema.index({ status: 1, timestamp: -1 });
donationSchema.index({ voucherHash: 1 }, { unique: true });

module.exports = mongoose.model('Donation', donationSchema);