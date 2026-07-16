const express = require('express');
const { exec } = require('child_process');

const app = express();

app.use(express.json());

app.post('/UPSWebhook', (req, res) => {
    console.log('Push detected');

    exec(`
        cd /home/gyools/UnityPortfolioServer &&
        git pull &&
        pm2 restart UPServer
    `, (err, stdout, stderr) => {
        console.log(stdout);
        console.log(stderr);
    });

    res.send('OK');
});

app.listen(3001, () => {
    console.log('Webhook server running');
});