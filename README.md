# Diniz Imóveis · Disparador WhatsApp

Sistema automático de consulta de disponibilidade de imóveis via WhatsApp.

## Como funciona

- Todo dia às **09:00** o sistema verifica a lista de imóveis
- Se o proprietário **não respondeu** → reenvia a mensagem todo dia
- Se o proprietário **respondeu** → aguarda 7 dias e pergunta novamente
- Proprietários com **mais de um imóvel** recebem uma mensagem única com todos os bairros

## Variáveis de ambiente (configurar no Railway)

| Variável | Descrição | Exemplo |
|---|---|---|
| `EVOLUTION_API_URL` | URL da sua Evolution API | `https://evolution-xxx.railway.app` |
| `EVOLUTION_API_KEY` | Senha da Evolution API | `Diniz2026` |
| `EVOLUTION_INSTANCE` | Nome da instância WhatsApp | `diniz` |
| `IMOVEIS_JSON` | Lista de imóveis em JSON | ver abaixo |

## Formato do IMOVEIS_JSON

```json
[
  {"nome": "José Garcia", "telefone": "5562998981961", "bairro": "Jundiaí", "codigo": "705"},
  {"nome": "Sergio", "telefone": "5562992686479", "bairro": "Jardim Alexandrina", "codigo": "9"}
]
```

## Endpoints

- `GET /` — status do sistema
- `GET /estado` — ver todas as respostas recebidas
- `POST /disparar` — disparo manual (envie `{"senha": "Diniz2026", "imoveis": [...]}`)
- `POST /webhook` — recebe respostas do WhatsApp (configurar na Evolution API)

## Mensagem enviada (1 imóvel)

> Olá, José! Aqui é o Bruno, da Diniz Imóveis. 🏠
> 
> Gostaria de confirmar se o imóvel no bairro Jundiaí ainda está disponível.
> 
> 1 · Sim, está disponível
> 2 · Não está mais disponível  
> 3 · Não, mas tenho outro imóvel disponível
> 4 · Sim, e tenho outro imóvel disponível

## Mensagem enviada (múltiplos imóveis)

> Olá, Sergio! Aqui é o Bruno, da Diniz Imóveis. 🏠
> 
> Gostaria de confirmar a disponibilidade dos seguintes imóveis:
> 
> 📍 Jardim Alexandrina
> 📍 Jundiaí
> 
> 1 · Todos disponíveis
> 2 · Nenhum disponível
> 3 · Alguns disponíveis (me diga quais)
> 4 · Tenho outros imóveis disponíveis
