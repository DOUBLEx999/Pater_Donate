const Donation = require('../models/Donation');

class DonationService {
  constructor(io) {
    this.io = io;
    this.baseURL = 'https://ownby4levy.vercel.app/api/redeem';
    this.timeout = 30000; // เพิ่มเวลา timeout
  }

  /**
   * แยก voucher hash จาก URL
   */
  extractVoucherHash(link) {
    try {
      const patterns = [
        /v=([a-zA-Z0-9]+)/,
        /\/([a-zA-Z0-9]+)$/,
        /gift\.truemoney\.com\/campaign\/\?v=([a-zA-Z0-9]+)/
      ];
      
      for (const pattern of patterns) {
        const match = link.match(pattern);
        if (match && match[1]) {
          return match[1];
        }
      }
      
      throw new Error('รูปแบบลิงก์ไม่ถูกต้อง');
    } catch (error) {
      throw new Error('รูปแบบลิงก์ไม่ถูกต้อง');
    }
  }

  /**
   * ตรวจสอบว่าซองอังเปาถูกใช้แล้วหรือไม่
   */
  async isDuplicateVoucher(voucherHash) {
    const existing = await Donation.findOne({ voucherHash });
    return !!existing;
  }

  /**
   * เรียก TrueMoney API
   */
  async callTrueMoneyAPI(voucherHash) {
    if (!process.env.TRUEMONEY_MOBILE) {
      throw new Error('กรุณาตั้งค่า TRUEMONEY_MOBILE ใน environment variables');
    }

    console.log('🔄 Calling TrueMoney API with hash:', voucherHash);

    const payload = {
      voucherCode: voucherHash, // ใช้ hash ไม่ใช่ full URL
      mobileNumber: process.env.TRUEMONEY_MOBILE
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(this.baseURL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      console.log('📡 TrueMoney API Response Status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ TrueMoney API Error Response:', errorText);
        throw new Error(`API Error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('📝 TrueMoney API Response Data:', JSON.stringify(data, null, 2));
      
      // ตรวจสอบความสำเร็จแบบละเอียด
      const isSuccess = data.success === true || 
                       data.status === 'success' || 
                       data.status?.code === 'SUCCESS' ||
                       data.status?.message === 'success' ||
                       (data.data && data.data.voucher);

      if (!isSuccess) {
        const errorMsg = data.message || data.error || data.status?.message || 'ไม่สามารถแลกซองอังเปาได้';
        console.error('❌ TrueMoney API Failed:', errorMsg);
        throw new Error(errorMsg);
      }

      // ดึงจำนวนเงินจากหลายจุด
      let amount = 0;
      
      if (data.data?.voucher?.amount_baht) {
        amount = parseFloat(data.data.voucher.amount_baht);
      } else if (data.data?.voucher?.redeemed_amount_baht) {
        amount = parseFloat(data.data.voucher.redeemed_amount_baht);
      } else if (data.data?.my_ticket?.amount_baht) {
        amount = parseFloat(data.data.my_ticket.amount_baht);
      } else if (data.amount_bath) {
        amount = parseFloat(data.amount_bath);
      } else if (data.amount) {
        amount = parseFloat(data.amount);
      } else if (data.value) {
        amount = parseFloat(data.value);
      }

      console.log('💰 Extracted amount:', amount);

      if (!amount || amount <= 0) {
        throw new Error('ไม่พบจำนวนเงินในซองอังเปา หรือซองอังเปาไม่ถูกต้อง');
      }

      return { amount, data };

    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('การเชื่อมต่อ API หมดเวลา กรุณาลองใหม่อีกครั้ง');
      }
      throw error;
    }
  }

  /**
   * ประมวลผลการบริจาค
   */
  async processDonation({ voucherLink, donorName, message, ipAddress }) {
    try {
      console.log('🔄 Processing donation:', { donorName, voucherLink });

      // แยก voucher hash
      const voucherHash = this.extractVoucherHash(voucherLink);
      console.log('🔑 Extracted voucher hash:', voucherHash);

      // ตรวจสอบซ้ำ
      if (await this.isDuplicateVoucher(voucherHash)) {
        throw new Error('ลิงก์นี้ถูกใช้งานไปแล้ว');
      }

      // เรียก API
      const { amount, data: apiData } = await this.callTrueMoneyAPI(voucherHash);

      // บันทึกข้อมูล
      const donation = new Donation({
        donorName,
        amount,
        message,
        voucherHash,
        voucherLink,
        ipAddress,
        status: 'completed',
        apiResponse: apiData // เก็บ response จาก API ด้วย
      });

      await donation.save();

      // ส่งข้อมูลแบบ real-time
      const donationData = {
        id: donation._id,
        donorName: donation.donorName,
        amount: donation.amount,
        message: donation.message,
        timestamp: donation.timestamp
      };

      this.io.emit('new-donation', donationData);

      console.log('✅ Donation processed successfully:', donationData);

      return {
        success: true,
        message: `ขอบคุณ ${donorName} สำหรับการบริจาค ${amount.toLocaleString()} บาท!`,
        data: donationData
      };

    } catch (error) {
      console.error('❌ Donation processing error:', error.message);
      
      // บันทึก error donation
      try {
        const errorDonation = new Donation({
          donorName,
          amount: 0,
          message,
          voucherHash: this.extractVoucherHash(voucherLink || '').catch(() => ''),
          voucherLink,
          ipAddress,
          status: 'failed',
          errorMessage: error.message
        });
        await errorDonation.save();
      } catch (saveError) {
        console.error('❌ Failed to save error donation:', saveError.message);
      }
      
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * ดึงข้อมูลการบริจาคล่าสุด
   */
  async getRecentDonations(limit = 10) {
    try {
      const donations = await Donation.find({ status: 'completed' })
        .sort({ timestamp: -1 })
        .limit(limit)
        .select('donorName amount message timestamp -_id')
        .lean();

      return donations;
    } catch (error) {
      console.error('❌ Error getting recent donations:', error.message);
      return [];
    }
  }

  /**
   * ดึงสถิติการบริจาค
   */
  async getDonationStats() {
    try {
      const stats = await Donation.aggregate([
        { $match: { status: 'completed' } },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: '$amount' },
            totalDonations: { $sum: 1 },
            averageAmount: { $avg: '$amount' },
            topDonation: { $max: '$amount' },
            lastDonation: { $max: '$timestamp' }
          }
        }
      ]);

      return stats[0] || {
        totalAmount: 0,
        totalDonations: 0,
        averageAmount: 0,
        topDonation: 0,
        lastDonation: null
      };
    } catch (error) {
      console.error('❌ Error getting stats:', error.message);
      return {
        totalAmount: 0,
        totalDonations: 0,
        averageAmount: 0,
        topDonation: 0,
        lastDonation: null
      };
    }
  }
}

module.exports = DonationService;