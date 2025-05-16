const TelegramBot = require('node-telegram-bot-api');
const {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, sendAndConfirmTransaction
} = require('@solana/web3.js');
const { getMint } = require('@solana/spl-token');
const bs58 = require('bs58');
const axios = require('axios');
require('dotenv').config();

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN || 'REPLACE_ME', { polling: true });
const connection = new Connection('https://api.mainnet-beta.solana.com');

const userWallets = {};
const userStates = {};
const referrals = {};
const alerts = {};
const premiumUsers = new Set();
const lastClaim = {}; // userId => timestamp

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
/alert - Set price alerts (premium)
/ref - Get referral link
/creator - Token creator (premium)
/create_token - Create memecoin (premium, ≥2 SOL)
/claim - Claim daily airdrop (premium)
/activate - Become Premium (requires ≥ 0.5 SOL)
/faq - Show full feature guide
/help - List commands
Support: @AlphaCapitalFx
`;

// START & REFERRAL
bot.onText(/\/start(?: (.+))?/, (msg, match) => {
  const ref = match?.[1];
  const userId = msg.from.id.toString();
  if (ref && ref !== userId) {
    if (!referrals[ref]) referrals[ref] = [];
    if (!referrals[ref].includes(userId)) {
      referrals[ref].push(userId);
      bot.sendMessage(ref, `You referred: @${msg.from.username || msg.from.first_name}`);
    }
  }
  bot.sendMessage(msg.chat.id, `Welcome ${msg.from.first_name || 'user'}! Type /help or /faq to begin.`);
});

// HELP & FAQ
bot.onText(/\/help/, msg => bot.sendMessage(msg.chat.id, HELP_MESSAGE));

bot.onText(/\/faq/, msg => {
  const faq = `
**Full Bot Guide**

1. /create — Generate a new Solana wallet
2. /import — Import your wallet via private key
3. /show — Show your wallet address & SOL balance
4. /withdraw — Send SOL to another wallet
5. /buy — Buy a token via Jupiter (input: <mint> <SOL>)
6. /sell — Sell token for SOL (input: <mint> <amount>)
7. /scan — Token info: price, liquidity, chart
8. /price <mint> — Show live price of token
9. /sol — Show current SOL price
10. /ref — Get your referral invite link
11. /activate — Upgrade to Premium (needs ≥0.5 SOL)
12. /creator — Check who deployed a token (premium)
13. /create_token — Deploy memecoin (premium, ≥2 SOL)
14. /alert — Get live price alerts (premium)
15. /claim — Claim daily token airdrop (premium)
16. /help — Quick command list
17. /faq — This full guide
`;
  bot.sendMessage(msg.chat.id, faq, { parse_mode: 'Markdown' });
});

// WALLET COMMANDS
bot.onText(/\/create/, msg => {
  const wallet = Keypair.generate();
  userWallets[msg.from.id] = wallet;
  const priv = bs58.encode(Uint8Array.from(wallet.secretKey));
  bot.sendMessage(msg.chat.id, `Wallet created.\nPublic: ${wallet.publicKey}\nPrivate: ${priv}`);
});

bot.onText(/\/import/, msg => {
  userStates[msg.from.id] = 'importing';
  bot.sendMessage(msg.chat.id, 'Send your Base58 private key:');
});

bot.onText(/\/show/, async msg => {
  const wallet = userWallets[msg.from.id];
  if (!wallet) return bot.sendMessage(msg.chat.id, 'No wallet found.');
  const balance = await connection.getBalance(wallet.publicKey);
  bot.sendMessage(msg.chat.id, `Address: ${wallet.publicKey}\nBalance: ${(balance / 1e9).toFixed(6)} SOL`);
});

bot.onText(/\/withdraw/, msg => {
  userStates[msg.from.id] = 'withdrawing';
  bot.sendMessage(msg.chat.id, 'Send: <recipient_address> <amount_in_SOL>');
});

// PREMIUM ACTIVATION
bot.onText(/\/activate/, async msg => {
  const wallet = userWallets[msg.from.id];
  if (!wallet) return bot.sendMessage(msg.chat.id, 'Import or create a wallet first.');
  const balance = await connection.getBalance(wallet.publicKey);
  if (balance < 0.5 * 1e9) return bot.sendMessage(msg.chat.id, 'Need ≥ 0.5 SOL to activate premium.');
  premiumUsers.add(msg.from.id);
  bot.sendMessage(msg.chat.id, 'Premium activated.');
});

// PREMIUM: CLAIM AIRDROP
bot.onText(/\/claim/, async msg => {
  const userId = msg.from.id;
  if (!premiumUsers.has(userId)) return bot.sendMessage(msg.chat.id, 'Premium only.');
  const now = Date.now();
  const last = lastClaim[userId] || 0;
  if (now - last < 86400000) return bot.sendMessage(msg.chat.id, 'You’ve already claimed today. Try again later.');
  lastClaim[userId] = now;
  bot.sendMessage(msg.chat.id, 'You claimed 50 $DROP from airdrop pool! (demo)');
});

// PREMIUM: CREATE TOKEN
bot.onText(/\/create_token/, msg => {
  if (!premiumUsers.has(msg.from.id)) return bot.sendMessage(msg.chat.id, 'Premium only.');
  userStates[msg.from.id] = 'token_create';
  bot.sendMessage(msg.chat.id, `Send token info:\nFormat:\nName,Symbol,Supply,Description`);
});

// REFERRAL LINK
bot.onText(/\/ref/, msg => {
  bot.sendMessage(msg.chat.id, `Your link: https://t.me/SnipeRaydium_Bot?start=${msg.from.id}`);
});

// PRICE COMMANDS
bot.onText(/\/price (.+)/, async (msg, match) => {
  const mint = match[1];
  try {
    const res = await axios.get(`https://price.jup.ag/v4/price?ids=${mint}`);
    const price = res.data[mint]?.price;
    if (!price) return bot.sendMessage(msg.chat.id, 'Price not found.');
    bot.sendMessage(msg.chat.id, `${mint}: $${price.toFixed(6)}`);
  } catch {
    bot.sendMessage(msg.chat.id, 'Failed to fetch price.');
  }
});

bot.onText(/\/sol/, async msg => {
  try {
    const res = await axios.get(`https://price.jup.ag/v4/price?ids=So11111111111111111111111111111111111111112`);
    const price = res.data["So11111111111111111111111111111111111111112"].price;
    bot.sendMessage(msg.chat.id, `SOL: $${price.toFixed(2)}`);
  } catch {
    bot.sendMessage(msg.chat.id, 'Failed to fetch SOL price.');
  }
});

// BUY / SELL
bot.onText(/\/buy/, msg => {
  userStates[msg.from.id] = 'buying';
  bot.sendMessage(msg.chat.id, 'Send: <TOKEN_MINT> <AMOUNT_IN_SOL>');
});

bot.onText(/\/sell/, msg => {
  userStates[msg.from.id] = 'selling';
  bot.sendMessage(msg.chat.id, 'Send: <TOKEN_MINT> <AMOUNT_TO_SELL>');
});

// SCAN / CREATOR
bot.onText(/\/scan/, msg => {
  userStates[msg.from.id] = 'scan';
  bot.sendMessage(msg.chat.id, 'Send token mint:');
});

bot.onText(/\/creator/, msg => {
  if (!premiumUsers.has(msg.from.id)) return bot.sendMessage(msg.chat.id, 'Premium only.');
  userStates[msg.from.id] = 'creator';
  bot.sendMessage(msg.chat.id, 'Send token mint address:');
});

// MESSAGE HANDLER
bot.on('message', async msg => {
  const text = msg.text?.trim();
  const state = userStates[msg.from.id];
  if (!state || text.startsWith('/')) return;

  try {
    const userId = msg.from.id;
    const wallet = userWallets[userId];

    if (state === 'importing') {
      const decoded = bs58.decode(text);
      const keypair = Keypair.fromSecretKey(Uint8Array.from(decoded));
      userWallets[userId] = keypair;
      bot.sendMessage(msg.chat.id, `Wallet imported: ${keypair.publicKey}`);
    }

    else if (state === 'withdrawing') {
      const [to, amt] = text.split(' ');
      const tx = new Transaction().add(SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new PublicKey(to),
        lamports: parseFloat(amt) * 1e9
      }));
      const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
      bot.sendMessage(msg.chat.id, `Sent ${amt} SOL\nTx: ${sig}`);
    }

    else if (state === 'scan') {
      const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${text}`);
      const token = res.data.pairs[0];
      const mintMeta = await getMint(connection, new PublicKey(text));
      bot.sendMessage(msg.chat.id, `Token: ${token.baseToken.name} (${token.baseToken.symbol})\nPrice: $${token.priceUsd}\nDecimals: ${mintMeta.decimals}\nLiquidity: $${token.liquidity.usd}\nChart: ${token.url}`);
    }

    else if (state === 'creator') {
      const info = await connection.getAccountInfo(new PublicKey(text));
      bot.sendMessage(msg.chat.id, `Creator: ${info?.owner.toString()}`);
    }

    else if (state === 'token_create') {
      const [name, symbol, supply, desc] = text.split(',');
      const balance = await connection.getBalance(wallet.publicKey);
      if (balance < 2 * 1e9) return bot.sendMessage(msg.chat.id, 'Need ≥ 2 SOL to create token.');
      // Simulate creation (replace with pump.fun actual API if available)
      bot.sendMessage(msg.chat.id, `Token created!\nName: ${name}\nSymbol: ${symbol}\nSupply: ${supply}\nExplorer: https://pump.fun/token/FAKE123TOKEN`);
    }

    else if (state === 'buying' || state === 'selling') {
      const [mint, amountStr] = text.split(' ');
      const amount = Math.floor(parseFloat(amountStr) * 1e9).toString();
      const inputMint = (state === 'buying') ? 'So11111111111111111111111111111111111111112' : mint;
      const outputMint = (state === 'buying') ? mint : 'So11111111111111111111111111111111111111112';
      const resp = await axios.post('https://quote-api.jup.ag/v6/swap', {
        userPublicKey: wallet.publicKey.toString(),
        wrapUnwrapSOL: true,
        dynamicSlippage: true,
        quoteResponse: { inputMint, outputMint, amount, slippageBps: 50 }
      });
      const tx = Transaction.from(Buffer.from(resp.data.swapTransaction, 'base64'));
      tx.partialSign(wallet);
      const sig = await connection.sendRawTransaction(tx.serialize());
      bot.sendMessage(msg.chat.id, `Swap successful!\nTx: ${sig}`);
    }
  } catch (err) {
    bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
  }

  userStates[msg.from.id] = null;
});

// ALERT CHECK (every 2 mins)
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
