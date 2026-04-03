'use strict';
 
const https = require('https');
const crypto = require('crypto');
 
// In-memory store: { [symbol]: { likes: number, ips: Set<hashedIp> } }
const stockStore = {};
 
function hashIp(ip) {
  return crypto.createHash('sha256').update(ip + 'stockchecker_salt').digest('hex');
}
 
function getStockData(symbol) {
  return new Promise((resolve, reject) => {
    const url = `https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock/${symbol}/quote`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (!parsed || parsed.Error || !parsed.latestPrice) {
            return reject(new Error('Invalid stock symbol'));
          }
          resolve({ stock: parsed.symbol || symbol.toUpperCase(), price: parsed.latestPrice });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}
 
function getOrCreateEntry(symbol) {
  const key = symbol.toUpperCase();
  if (!stockStore[key]) {
    stockStore[key] = { likes: 0, ips: new Set() };
  }
  return stockStore[key];
}
 
module.exports = function (app) {
 
  app.route('/api/stock-prices')
    .get(async function (req, res) {
      try {
        const { stock, like } = req.query;
        const wantLike = like === 'true';
        const clientIp = hashIp(req.ip || req.connection.remoteAddress || '0.0.0.0');
 
        // Single stock
        if (!Array.isArray(stock)) {
          if (!stock) return res.json({ error: 'stock parameter required' });
 
          const data = await getStockData(stock);
          const entry = getOrCreateEntry(data.stock);
 
          if (wantLike && !entry.ips.has(clientIp)) {
            entry.likes++;
            entry.ips.add(clientIp);
          }
 
          return res.json({
            stockData: {
              stock: data.stock,
              price: data.price,
              likes: entry.likes
            }
          });
        }
 
        // Two stocks
        if (stock.length !== 2) {
          return res.status(400).json({ error: 'Provide 1 or 2 stock symbols' });
        }
 
        const [data1, data2] = await Promise.all([
          getStockData(stock[0]),
          getStockData(stock[1])
        ]);
 
        const entry1 = getOrCreateEntry(data1.stock);
        const entry2 = getOrCreateEntry(data2.stock);
 
        if (wantLike) {
          if (!entry1.ips.has(clientIp)) {
            entry1.likes++;
            entry1.ips.add(clientIp);
          }
          if (!entry2.ips.has(clientIp)) {
            entry2.likes++;
            entry2.ips.add(clientIp);
          }
        }
 
        return res.json({
          stockData: [
            { stock: data1.stock, price: data1.price, rel_likes: entry1.likes - entry2.likes },
            { stock: data2.stock, price: data2.price, rel_likes: entry2.likes - entry1.likes }
          ]
        });
 
      } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message || 'Failed to fetch stock data' });
      }
    });
 
};
 