require('dotenv').config();
const express = require('express');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/api/v1', apiRoutes.router);
app.use('/admin', adminRoutes.router);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`License server running on port ${PORT}`);
  });
}

module.exports = { app };
