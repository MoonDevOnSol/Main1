const TelegramBot = require('node-telegram-bot-api');
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { getMint } = require('@solana/spl-token');
const bs58 = require('bs58');
const axios = require('axios');
require('dotenv').config();

const TOKEN = process.env.TELEGRAM_TOKEN || 'REPLACE_ME';
const RPC_URL = 'https://api.mainnet-beta.solana.com';

const bot = new TelegramBot(TOKEN, { polling: true });
const connection = new Connection(RPC_URL);

const userWallets = {};
const userStates = {};
const referrals = {};
const alerts = {};
const premiumUsers = new Set();

const HELP_MESSAGE = `
Available Commands:
/start - Start bot
/create - Create wallet
/import - Import wallet
/show - Show wallet info
/withdraw - Withdraw SOL
/buy - Buy token
/sell - Sell token
/scan - Scan token info
/price <TOKEN> - Token price
/sol - SOL price
/alert - Set price alerts
/ref - Get referral link
/creator - Token creator
/activate - Become Premium
/help - List all commands
Support: @AlphaCapitalFx
`;

// START & REFERRAL
bot.onText(/\/start(?: (.+))?/, (msg, match) => {
  const ref = match[1];
  const userId = msg.from.id;
  if (ref && ref !== userId.toString()) {
    if (!referrals[ref]) referrals[ref] = [];
    if (!referrals[ref].includes(userId)) {
      referrals[ref].push(userId);
      bot.sendMessage(ref, `You referred: @${msg.from.username || msg.from.first_name}`);
    }
  }
  bot.sendMessage(msg.chat.id, `Welcome ${msg.from.first_name || 'user'}! Type /help for all commands.`);
});

// HELP
bot.onText(/\/help/, (msg) => bot.sendMessage(msg.chat.id, HELP_MESSAGE));

// WALLET
bot.onText(/\/create/, (msg) => {
  const wallet = Keypair.generate();
  userWallets[msg.from.id] = wallet;
  const priv = bs58.encode(Uint8Array.from(wallet.secretKey));
  bot.sendMessage(msg.chat.id, `Wallet created.\nPublic: ${wallet.publicKey}\nPrivate: ${priv}`);
});

bot.onText(/\/import/, (msg) => {
  userStates[msg.from.id] = 'importing';
  bot.sendMessage(msg.chat.id, 'Send your Base58 private key:');
});

bot.onText(/\/show/, async (msg) => {
  const wallet = userWallets[msg.from.id];
  if (!wallet) return bot.sendMessage(msg.chat.id, 'No wallet found.');
  const balance = await connection.getBalance(wallet.publicKey);
  bot.sendMessage(msg.chat.id, `Address: ${wallet.publicKey.toString()}\nBalance: ${(balance / 1e9).toFixed(6)} SOL`);
});

bot.onText(/\/withdraw/, (msg) => {
  userStates[msg.from.id] = 'withdrawing';
  bot.sendMessage(msg.chat.id, 'Send: <recipient_address> <amount_in_SOL>');
});

// PREMIUM
bot.onText(/\/activate/, (msg) => {
  premiumUsers.add(msg.from.id);
  bot.sendMessage(msg.chat.id, 'Premium activated! You now have access to more features.');
});

bot.onText(/\/ref/, (msg) => {
  bot.sendMessage(msg.chat.id, `Your referral link:\nhttps://t.me/YOUR_BOT_USERNAME?start=${msg.from.id}`);
});

// ALERTS
bot.onText(/\/alert/, (msg) => {
  if (!premiumUsers.has(msg.from.id)) return bot.sendMessage(msg.chat.id, 'Premium required. Use /activate');
  userStates[msg.from.id] = 'set_alert';
  bot.sendMessage(msg.chat.id, 'Send token mint to watch for price alerts:');
});

// TOKEN CREATOR
bot.onText(/\/creator/, (msg) => {
  if (!premiumUsers.has(msg.from.id)) return bot.sendMessage(msg.chat.id, 'Premium required. Use /activate');
  userStates[msg.from.id] = 'get_creator';
  bot.sendMessage(msg.chat.id, 'Send token mint address to fetch creator:');
});

// SCAN TOKEN
bot.onText(/\/scan/, (msg) => {
  userStates[msg.from.id] = 'scan_token';
  bot.sendMessage(msg.chat.id, 'Send token mint to scan:');
});

// PRICE
bot.onText(/\/price (.+)/, async (msg, match) => {
  const token = match[1];
  try {
    const res = await axios.get(`https://price.jup.ag/v4/price?ids=${token}`);
    const price = res.data[token]?.price;
    if (!price) return bot.sendMessage(msg.chat.id, 'Token price not found.');
    bot.sendMessage(msg.chat.id, `${token}: $${price.toFixed(6)}`);
  } catch {
    bot.sendMessage(msg.chat.id, 'Error fetching price.');
  }
});

bot.onText(/\/sol/, async (msg) => {
  const id = 'So11111111111111111111111111111111111111112';
  const res = await axios.get(`https://price.jup.ag/v4/price?ids=${id}`);
  const price = res.data[id]?.price;
  bot.sendMessage(msg.chat.id, `SOL: $${price.toFixed(2)}`);
});

// BUY / SELL
bot.onText(/\/buy/, (msg) => {
  userStates[msg.from.id] = 'buying';
  bot.sendMessage(msg.chat.id, 'Send: <TOKEN_MINT> <AMOUNT_IN_SOL>');
});

bot.onText(/\/sell/, (msg) => {
  userStates[msg.from.id] = 'selling';
  bot.sendMessage(msg.chat.id, 'Send: <TOKEN_MINT> <AMOUNT_TO_SELL>');
});

// STATE HANDLER
bot.on('message', async (msg) => {
  const text = msg.text.trim();
  const userId = msg.from.id;
  const state = userStates[userId];
  if (!state || text.startsWith('/')) return;

  try {
    if (state === 'importing') {
      const wallet = Keypair.fromSecretKey(bs58.decode(text));
      userWallets[userId] = wallet;
      bot.sendMessage(msg.chat.id, `Wallet imported: ${wallet.publicKey.toString()}`);
    }

    else if (state === 'withdrawing') {
      const [to, amount] = text.split(' ');
      const tx = new Transaction().add(SystemProgram.transfer({
        fromPubkey: userWallets[userId].publicKey,
        toPubkey: new PublicKey(to),
        lamports: parseFloat(amount) * 1e9
      }));
      const sig = await sendAndConfirmTransaction(connection, tx, [userWallets[userId]]);
      bot.sendMessage(msg.chat.id, `Sent ${amount} SOL\nTx: ${sig}`);
    }

    else if (state === 'scan_token') {
      const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${text}`);
      const token = res.data.pairs[0];
      const mintMeta = await getMint(connection, new PublicKey(text));
      bot.sendMessage(msg.chat.id, `Token: ${token.baseToken.name} (${token.baseToken.symbol})
Price: $${parseFloat(token.priceUsd).toFixed(6)}
Decimals: ${mintMeta.decimals}
Liquidity: $${token.liquidity.usd.toFixed(2)}
Chart: ${token.url}`);
    }

    else if (state === 'get_creator') {
      const accInfo = await connection.getAccountInfo(new PublicKey(text));
      if (!accInfo) return bot.sendMessage(msg.chat.id, 'Token not found.');
      bot.sendMessage(msg.chat.id, `Token creator: ${accInfo.owner.toString()}`);
    }

    else if (state === 'set_alert') {
      if (!alerts[userId]) alerts[userId] = [];
      if (!alerts[userId].includes(text)) alerts[userId].push(text);
      bot.sendMessage(msg.chat.id, `Alert set for ${text}`);
    }

    else if (state === 'buying' || state === 'selling') {
      const [mint, amountStr] = text.split(' ');
      const amount = (parseFloat(amountStr) * 1e9).toFixed(0);
      const wallet = userWallets[userId];
      const inputMint = (state === 'buying') ? 'So11111111111111111111111111111111111111112' : mint;
      const outputMint = (state === 'buying') ? mint : 'So11111111111111111111111111111111111111112';

      const resp = await axios.post('https://quote-api.jup.ag/v6/swap', {
        userPublicKey: wallet.publicKey.toString(),
        wrapUnwrapSOL: true,
        dynamicSlippage: true,
        quoteResponse: {
          inputMint, outputMint, amount, slippageBps: 50
        }
      });

      const tx = Transaction.from(Buffer.from(resp.data.swapTransaction, 'base64'));
      tx.partialSign(wallet);
      const sig = await connection.sendRawTransaction(tx.serialize());
      bot.sendMessage(msg.chat.id, `Swap successful!\nTx: ${sig}`);
    }

  } catch (err) {
    bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
  }

  userStates[userId] = null;
});

// Background alerts (every 2 mins)
setInterval(async () => {
  for (const [userId, mints] of Object.entries(alerts)) {
    for (const mint of mints) {
      try {
        const res = await axios.get(`https://price.jup.ag/v4/price?ids=${mint}`);
        const price = res.data[mint]?.price;
        if (price) bot.sendMessage(userId, `ALERT: ${mint} = $${price.toFixed(6)}`);
      } catch {}
    }
  }
}, 120000);
