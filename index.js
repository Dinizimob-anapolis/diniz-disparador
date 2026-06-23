const express = require('express');
const cron = require('node-cron');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// ============================================================
// CONFIGURAÇÕES — preencha após deploy
// ============================================================
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const EVOLUTION_API_KEY  = process.env.EVOLUTION_API_KEY  || 'Diniz2026';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'diniz';
const PORT = process.env.PORT || 3000;
const LIMITE_DIARIO = 30; // máximo de disparos por dia

// Arquivo de estado (persiste respostas e datas)
const STATE_FILE = path.join(__dirname, 'estado.json');

// ============================================================
// UTILITÁRIOS
// ============================================================

function carregarEstado() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }
  return {};
}

function salvarEstado(estado) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(estado, null, 2));
}

// Extrai número de telefone de strings como "José Garcia (62) 99898-1961"
function extrairTelefone(texto) {
  if (!texto) return null;
  // Remove caracteres não numéricos
  const nums = texto.replace(/\D/g, '');
  if (nums.length === 0) return null;
  
  // Se já tem 13 dígitos (55 + DDD + número), usa direto
  if (nums.length === 13 && nums.startsWith('55')) return nums;
  // Se tem 11 dígitos (DDD + número com 9)
  if (nums.length === 11) return '55' + nums;
  // Se tem 10 dígitos (DDD + número sem 9)
  if (nums.length === 10) return '55' + nums;
  // Se tem 9 dígitos (número sem DDD — usa 62 padrão)
  if (nums.length === 9) return '5562' + nums;
  // Se tem 8 dígitos (número sem DDD sem 9)
  if (nums.length === 8) return '55629' + nums;
  
  return nums.length >= 10 ? '55' + nums.slice(-11) : null;
}

// Extrai nome (parte antes do telefone)
function extrairNome(texto) {
  if (!texto) return 'Proprietário';
  // Remove o telefone do final
  const nome = texto.replace(/[\s\(]*([\d\s\-\(\)]+)$/, '').trim();
  return nome || texto.trim();
}

// Agrupa imóveis por telefone do proprietário
function agruparPorProprietario(imoveis) {
  const grupos = {};
  for (const im of imoveis) {
    const tel = im.telefone;
    if (!tel) continue;
    if (!grupos[tel]) {
      grupos[tel] = {
        telefone: tel,
        nome: im.nome,
        imoveis: []
      };
    }
    grupos[tel].imoveis.push(im);
  }
  return grupos;
}

// Monta mensagem para um proprietário
function montarMensagem(grupo) {
  const { nome, imoveis } = grupo;
  const primeiroNome = nome.split(' ')[0];

  if (imoveis.length === 1) {
    const im = imoveis[0];
    return `Olá, ${primeiroNome}! Aqui é o Bruno, da *Diniz Imóveis*. 🏠\n\nGostaria de confirmar se o imóvel no bairro *${im.bairro}* ainda está disponível para negociação.\n\nResponda com o número:\n*1* · Sim, está disponível\n*2* · Não está mais disponível\n*3* · Não, mas tenho outro imóvel disponível\n*4* · Sim, e tenho outro imóvel disponível\n\nObrigado! 😊`;
  } else {
    const listaBairros = imoveis.map(im => `📍 *${im.bairro}*`).join('\n');
    return `Olá, ${primeiroNome}! Aqui é o Bruno, da *Diniz Imóveis*. 🏠\n\nGostaria de confirmar a disponibilidade dos seguintes imóveis:\n\n${listaBairros}\n\nResponda com o número:\n*1* · Todos disponíveis\n*2* · Nenhum disponível\n*3* · Alguns disponíveis (me diga quais)\n*4* · Tenho outros imóveis disponíveis\n\nObrigado! 😊`;
  }
}

// ============================================================
// ENVIO VIA EVOLUTION API
// ============================================================

async function enviarMensagem(telefone, mensagem) {
  const url = `${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`;
  const response = await axios.post(url, {
    number: telefone,
    text: mensagem
  }, {
    headers: {
      'apikey': EVOLUTION_API_KEY,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });
  return response.data;
}

// ============================================================
// LÓGICA PRINCIPAL DE DISPARO
// ============================================================

async function executarDisparo(imoveis) {
  const estado = carregarEstado();
  const agora = new Date();
  const grupos = agruparPorProprietario(imoveis);
  
  let enviados = 0;
  let pulados = 0;

  // Verifica quantos já foram enviados hoje
  const hoje = new Date().toISOString().slice(0, 10);
  const enviadosHoje = Object.values(estado).filter(r => 
    r.ultimoEnvio && new Date(r.ultimoEnvio).toISOString().slice(0, 10) === hoje
  ).length;

  if (enviadosHoje >= LIMITE_DIARIO) {
    console.log(`⚠️ Limite diário de ${LIMITE_DIARIO} disparos atingido. Tente amanhã.`);
    return { enviados: 0, pulados: Object.keys(grupos).length, motivo: 'limite_diario' };
  }

  let restante = LIMITE_DIARIO - enviadosHoje;
  console.log(`📊 Já enviados hoje: ${enviadosHoje} | Restante: ${restante}`);

  for (const [tel, grupo] of Object.entries(grupos)) {
    if (restante <= 0) {
      console.log(`⛔ Limite de ${LIMITE_DIARIO} disparos diários atingido.`);
      break;
    }
    const reg = estado[tel] || {};
    const agora_ts = agora.getTime();

    // Verificar se deve enviar
    let deveEnviar = false;
    let motivo = '';

    if (!reg.ultimoEnvio) {
      // Nunca enviou — envia agora
      deveEnviar = true;
      motivo = 'primeiro envio';
    } else if (reg.respondeu) {
      // Já respondeu — aguarda 7 dias
      const diasDesdeResposta = (agora_ts - reg.dataResposta) / (1000 * 60 * 60 * 24);
      if (diasDesdeResposta >= 7) {
        deveEnviar = true;
        motivo = `respondeu há ${Math.floor(diasDesdeResposta)} dias`;
      } else {
        pulados++;
        continue;
      }
    } else {
      // Não respondeu — reenvia todo dia
      const diasDesdeEnvio = (agora_ts - reg.ultimoEnvio) / (1000 * 60 * 60 * 24);
      if (diasDesdeEnvio >= 1) {
        deveEnviar = true;
        motivo = `sem resposta há ${Math.floor(diasDesdeEnvio)} dias`;
      } else {
        pulados++;
        continue;
      }
    }

    if (deveEnviar) {
      try {
        const mensagem = montarMensagem(grupo);
        await enviarMensagem(tel, mensagem);
        
        // Atualiza estado
        estado[tel] = {
          ...reg,
          nome: grupo.nome,
          ultimoEnvio: agora_ts,
          respondeu: false,
          tentativas: (reg.tentativas || 0) + 1,
          motivo
        };
        
        console.log(`✅ Enviado para ${grupo.nome} (${tel}) — ${motivo}`);
        enviados++;
        restante--;
        
        // Delay entre envios para não bloquear (3 segundos)
        await new Promise(r => setTimeout(r, 3000));
      } catch (err) {
        console.error(`❌ Erro ao enviar para ${grupo.nome} (${tel}):`, err.message);
      }
    }
  }

  salvarEstado(estado);
  console.log(`\n📊 Disparo concluído: ${enviados} enviados, ${pulados} pulados`);
  return { enviados, pulados };
}

// ============================================================
// WEBHOOK — recebe respostas dos proprietários
// ============================================================

app.post('/webhook', (req, res) => {
  try {
    const body = req.body;
    
    // Formato Evolution API v2
    const evento = body?.event || body?.type;
    if (evento !== 'messages.upsert' && evento !== 'message') {
      return res.json({ ok: true });
    }

    const msg = body?.data?.message || body?.message;
    const from = body?.data?.key?.remoteJid || body?.from || '';
    const texto = msg?.conversation || msg?.extendedTextMessage?.text || '';
    
    if (!from || !texto) return res.json({ ok: true });

    // Extrai telefone do JID (formato: 5562999990001@s.whatsapp.net)
    const tel = from.replace('@s.whatsapp.net', '').replace('@c.us', '');
    
    const estado = carregarEstado();
    
    if (estado[tel]) {
      estado[tel].respondeu = true;
      estado[tel].dataResposta = Date.now();
      estado[tel].ultimaResposta = texto.trim();
      salvarEstado(estado);
      console.log(`💬 Resposta recebida de ${tel}: "${texto.trim()}"`);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Erro no webhook:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ROTAS DE CONTROLE
// ============================================================

// Status do sistema
app.get('/', (req, res) => {
  const estado = carregarEstado();
  const total = Object.keys(estado).length;
  const responderam = Object.values(estado).filter(r => r.respondeu).length;
  const pendentes = total - responderam;
  
  res.json({
    sistema: 'Diniz Imóveis · Disparador WhatsApp',
    status: 'online',
    estatisticas: { total, responderam, pendentes },
    proximoDisparo: 'Diariamente às 09:00'
  });
});

// Disparo manual (para testar)
app.post('/disparar', async (req, res) => {
  const { senha, imoveis } = req.body;
  
  if (senha !== EVOLUTION_API_KEY && senha !== 'Diniz2026') {
    return res.status(401).json({ error: 'Senha incorreta' });
  }

  if (!imoveis || !Array.isArray(imoveis)) {
    return res.status(400).json({ error: 'Envie a lista de imóveis no campo "imoveis"' });
  }

  try {
    const resultado = await executarDisparo(imoveis);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ver estado atual
app.get('/estado', (req, res) => {
  const estado = carregarEstado();
  res.json(estado);
});

// Resetar um número (para testes)
app.delete('/estado/:telefone', (req, res) => {
  const estado = carregarEstado();
  delete estado[req.params.telefone];
  salvarEstado(estado);
  res.json({ ok: true });
});

// ============================================================
// AGENDADOR — roda todo dia às 09:00
// ============================================================

// Os imóveis são carregados via variável de ambiente IMOVEIS_JSON
// ou pelo endpoint /disparar manualmente

// Disparo único hoje às 10:00 (23/06/2026)
cron.schedule('0 10 23 6 *', async () => {
  console.log('\n⏰ Disparo especial 10:00 —', new Date().toLocaleString('pt-BR'));
  const imoveisPath = path.join(__dirname, 'imoveis.json');
  if (!fs.existsSync(imoveisPath)) return;
  try {
    const imoveis = JSON.parse(fs.readFileSync(imoveisPath, 'utf8'));
    await executarDisparo(imoveis);
  } catch (err) {
    console.error('Erro:', err.message);
  }
}, { timezone: 'America/Sao_Paulo' });

// Disparo diário às 09:00
cron.schedule('0 9 * * *', async () => {
  console.log('\n⏰ Disparo agendado iniciado —', new Date().toLocaleString('pt-BR'));
  
  const imoveisPath = path.join(__dirname, 'imoveis.json');
  if (!fs.existsSync(imoveisPath)) {
    console.log('⚠️ Arquivo imoveis.json não encontrado.');
    return;
  }

  try {
    const imoveis = JSON.parse(fs.readFileSync(imoveisPath, 'utf8'));
    console.log(`📋 ${imoveis.length} imóveis carregados do arquivo.`);
    await executarDisparo(imoveis);
  } catch (err) {
    console.error('Erro no disparo agendado:', err.message);
  }
}, {
  timezone: 'America/Sao_Paulo'
});

// ============================================================
// START
// ============================================================

app.listen(PORT, () => {
  console.log(`\n🏠 Diniz Imóveis · Disparador WhatsApp`);
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📅 Disparo agendado: todo dia às 09:00 (Brasília)`);
  console.log(`🔗 Evolution API: ${EVOLUTION_API_URL}`);
});
