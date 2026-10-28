/** Dados demonstrativos do protótipo aprovado. Taxas e regimes são pressupostos editáveis, não regras fiscais certificadas. */
import { FinancialModelError, type FinancialSector } from './types.js';
import { validateFinancialAssumptions } from './validation.js';
const TEMPLATES = {
  "mineracao": {
    "name": "Mineração",
    "description": "Diamantes, ouro, minerais — produção, preço internacional, royalties",
    "currency": "USD",
    "sampleOnly": true,
    "assumptions": {
      "horizonte": 12,
      "inicioOp": 1,
      "preOp": 25,
      "inflacao": 2.5,
      "ii": 25,
      "royalty": 5,
      "cvar": 12,
      "pessoal": 3200000,
      "fst": 2800000,
      "outros": 600000,
      "manut": 3,
      "vidaManut": 5,
      "dso": 30,
      "dio": 45,
      "dpo": 60,
      "capitalInicial": 16000000,
      "payout": 40,
      "caixaMin": 1500000,
      "divida": {
        "montante": 15000000,
        "taxa": 9,
        "prazo": 7,
        "carencia": 2,
        "ano": 0
      },
      "wacc": {
        "modo": "capm",
        "rf": 4.3,
        "erp": 5.5,
        "beta": 1.3,
        "crp": 7.5,
        "kd": 9,
        "wd": 45,
        "manual": 16
      },
      "tv": {
        "metodo": "nenhum",
        "g": 0,
        "mult": 4.5
      },
      "cov": {
        "dscr": 1.3,
        "ndEbitda": 3.5,
        "icr": 3
      },
      "mult": {
        "lo": 4,
        "hi": 7
      },
      "sens": 20,
      "cenarios": {
        "base": {
          "preco": 1,
          "volume": 1,
          "opex": 1,
          "capex": 1
        },
        "otim": {
          "preco": 1.1,
          "volume": 1.1,
          "opex": 0.95,
          "capex": 0.95
        },
        "pess": {
          "preco": 0.85,
          "volume": 0.85,
          "opex": 1.1,
          "capex": 1.15
        }
      },
      "cen": "base",
      "inicio": "greenfield",
      "abertura": {
        "imob": 0,
        "vidaRem": 8,
        "exist": 0,
        "clientes": 0,
        "caixa": 0,
        "fornec": 0,
        "divida": 0,
        "divTaxa": 12,
        "divPrazo": 4
      },
      "anoBase": 2026,
      "nome": "Projecto mineiro — diamantes aluvionares",
      "receitas": [
        {
          "nome": "Diamantes",
          "unid": "quilates",
          "qtd": 150000,
          "cresc": 1,
          "ramp": "40,75,100",
          "preco": 180,
          "esc": 1.5
        }
      ],
      "capex": [
        {
          "nome": "Planta de tratamento (DMS)",
          "ano": 0,
          "valor": 14000000,
          "vida": 10
        },
        {
          "nome": "Infra-estruturas e acampamento",
          "ano": 0,
          "valor": 4500000,
          "vida": 12
        },
        {
          "nome": "Prospecção e sondagens",
          "ano": 0,
          "valor": 3000000,
          "vida": 5
        },
        {
          "nome": "Frota e equipamento móvel",
          "ano": 1,
          "valor": 9000000,
          "vida": 6
        }
      ]
    }
  },
  "petroleo": {
    "name": "Petróleo & Gás",
    "description": "Upstream — produção em declínio, preço Brent, IRP e IPP",
    "currency": "USD",
    "sampleOnly": true,
    "assumptions": {
      "horizonte": 15,
      "inicioOp": 2,
      "preOp": 25,
      "inflacao": 2.5,
      "ii": 50,
      "royalty": 20,
      "cvar": 8,
      "pessoal": 6000000,
      "fst": 14000000,
      "outros": 3000000,
      "manut": 4,
      "vidaManut": 5,
      "dso": 30,
      "dio": 15,
      "dpo": 45,
      "capitalInicial": 260000000,
      "payout": 50,
      "caixaMin": 10000000,
      "divida": {
        "montante": 200000000,
        "taxa": 9.5,
        "prazo": 8,
        "carencia": 2,
        "ano": 1
      },
      "wacc": {
        "modo": "capm",
        "rf": 4.3,
        "erp": 5.5,
        "beta": 1.1,
        "crp": 7.5,
        "kd": 9.5,
        "wd": 40,
        "manual": 15
      },
      "tv": {
        "metodo": "nenhum",
        "g": 0,
        "mult": 4
      },
      "cov": {
        "dscr": 1.3,
        "ndEbitda": 3.5,
        "icr": 3
      },
      "mult": {
        "lo": 4,
        "hi": 7
      },
      "sens": 20,
      "cenarios": {
        "base": {
          "preco": 1,
          "volume": 1,
          "opex": 1,
          "capex": 1
        },
        "otim": {
          "preco": 1.1,
          "volume": 1.1,
          "opex": 0.95,
          "capex": 0.95
        },
        "pess": {
          "preco": 0.85,
          "volume": 0.85,
          "opex": 1.1,
          "capex": 1.15
        }
      },
      "cen": "base",
      "inicio": "greenfield",
      "abertura": {
        "imob": 0,
        "vidaRem": 8,
        "exist": 0,
        "clientes": 0,
        "caixa": 0,
        "fornec": 0,
        "divida": 0,
        "divTaxa": 12,
        "divPrazo": 4
      },
      "anoBase": 2026,
      "nome": "Bloco offshore — desenvolvimento de campo",
      "receitas": [
        {
          "nome": "Crude",
          "unid": "barris",
          "qtd": 4380000,
          "cresc": -8,
          "ramp": "60,100",
          "preco": 75,
          "esc": 0
        }
      ],
      "capex": [
        {
          "nome": "Estudos sísmicos e engenharia",
          "ano": 0,
          "valor": 25000000,
          "vida": 5
        },
        {
          "nome": "Perfuração e completação de poços",
          "ano": 0,
          "valor": 180000000,
          "vida": 10
        },
        {
          "nome": "Instalações de produção (FPSO)",
          "ano": 1,
          "valor": 220000000,
          "vida": 15
        }
      ]
    }
  },
  "agro": {
    "name": "Agro-indústria",
    "description": "Culturas, produção pecuária, agro-processamento",
    "currency": "Kz",
    "sampleOnly": true,
    "assumptions": {
      "horizonte": 10,
      "inicioOp": 1,
      "preOp": 25,
      "inflacao": 18,
      "ii": 10,
      "royalty": 0,
      "cvar": 45,
      "pessoal": 280000000,
      "fst": 190000000,
      "outros": 60000000,
      "manut": 2.5,
      "vidaManut": 5,
      "dso": 45,
      "dio": 90,
      "dpo": 60,
      "capitalInicial": 1600000000,
      "payout": 30,
      "caixaMin": 150000000,
      "divida": {
        "montante": 1800000000,
        "taxa": 7.5,
        "prazo": 8,
        "carencia": 2,
        "ano": 0
      },
      "wacc": {
        "modo": "capm",
        "rf": 17,
        "erp": 6,
        "beta": 0.9,
        "crp": 0,
        "kd": 7.5,
        "wd": 50,
        "manual": 18
      },
      "tv": {
        "metodo": "gordon",
        "g": 8,
        "mult": 5
      },
      "cov": {
        "dscr": 1.3,
        "ndEbitda": 3.5,
        "icr": 3
      },
      "mult": {
        "lo": 4,
        "hi": 7
      },
      "sens": 20,
      "cenarios": {
        "base": {
          "preco": 1,
          "volume": 1,
          "opex": 1,
          "capex": 1
        },
        "otim": {
          "preco": 1.1,
          "volume": 1.1,
          "opex": 0.95,
          "capex": 0.95
        },
        "pess": {
          "preco": 0.85,
          "volume": 0.85,
          "opex": 1.1,
          "capex": 1.15
        }
      },
      "cen": "base",
      "inicio": "greenfield",
      "abertura": {
        "imob": 0,
        "vidaRem": 8,
        "exist": 0,
        "clientes": 0,
        "caixa": 0,
        "fornec": 0,
        "divida": 0,
        "divTaxa": 12,
        "divPrazo": 4
      },
      "anoBase": 2026,
      "nome": "Fazenda de cereais com irrigação",
      "receitas": [
        {
          "nome": "Milho",
          "unid": "toneladas",
          "qtd": 6000,
          "cresc": 6,
          "ramp": "50,80,100",
          "preco": 260000,
          "esc": 12
        },
        {
          "nome": "Feijão",
          "unid": "toneladas",
          "qtd": 800,
          "cresc": 5,
          "ramp": "50,80,100",
          "preco": 900000,
          "esc": 12
        }
      ],
      "capex": [
        {
          "nome": "Preparação de terras e pivots de rega",
          "ano": 0,
          "valor": 1600000000,
          "vida": 15
        },
        {
          "nome": "Tractores e alfaias",
          "ano": 0,
          "valor": 950000000,
          "vida": 8
        },
        {
          "nome": "Armazém e secador",
          "ano": 1,
          "valor": 700000000,
          "vida": 20
        }
      ]
    }
  },
  "comercio": {
    "name": "Comércio & Distribuição",
    "description": "Grosso, retalho, distribuição — margem e fundo de maneio",
    "currency": "Kz",
    "sampleOnly": true,
    "assumptions": {
      "horizonte": 7,
      "inicioOp": 1,
      "preOp": 25,
      "inflacao": 18,
      "ii": 25,
      "royalty": 0,
      "cvar": 74,
      "pessoal": 520000000,
      "fst": 640000000,
      "outros": 120000000,
      "manut": 1,
      "vidaManut": 5,
      "dso": 35,
      "dio": 60,
      "dpo": 45,
      "capitalInicial": 1600000000,
      "payout": 35,
      "caixaMin": 200000000,
      "divida": {
        "montante": 1200000000,
        "taxa": 19,
        "prazo": 5,
        "carencia": 1,
        "ano": 0
      },
      "wacc": {
        "modo": "capm",
        "rf": 17,
        "erp": 6,
        "beta": 1,
        "crp": 0,
        "kd": 19,
        "wd": 40,
        "manual": 22
      },
      "tv": {
        "metodo": "gordon",
        "g": 8,
        "mult": 6
      },
      "cov": {
        "dscr": 1.3,
        "ndEbitda": 3.5,
        "icr": 3
      },
      "mult": {
        "lo": 4,
        "hi": 7
      },
      "sens": 20,
      "cenarios": {
        "base": {
          "preco": 1,
          "volume": 1,
          "opex": 1,
          "capex": 1
        },
        "otim": {
          "preco": 1.1,
          "volume": 1.1,
          "opex": 0.95,
          "capex": 0.95
        },
        "pess": {
          "preco": 0.85,
          "volume": 0.85,
          "opex": 1.1,
          "capex": 1.15
        }
      },
      "cen": "base",
      "inicio": "greenfield",
      "abertura": {
        "imob": 0,
        "vidaRem": 8,
        "exist": 0,
        "clientes": 0,
        "caixa": 0,
        "fornec": 0,
        "divida": 0,
        "divTaxa": 12,
        "divPrazo": 4
      },
      "anoBase": 2026,
      "nome": "Distribuidora de bens alimentares",
      "receitas": [
        {
          "nome": "Vendas de mercadorias",
          "unid": "toneladas",
          "qtd": 12000,
          "cresc": 8,
          "ramp": "70,100",
          "preco": 850000,
          "esc": 14
        }
      ],
      "capex": [
        {
          "nome": "Armazém (obras e equipamento)",
          "ano": 0,
          "valor": 900000000,
          "vida": 15
        },
        {
          "nome": "Frota de distribuição",
          "ano": 0,
          "valor": 750000000,
          "vida": 5
        },
        {
          "nome": "Sistemas e equipamento",
          "ano": 0,
          "valor": 120000000,
          "vida": 4
        }
      ]
    }
  },
  "servicos": {
    "name": "Serviços & Consultoria",
    "description": "Horas facturadas, avenças — intensivo em pessoal",
    "currency": "Kz",
    "sampleOnly": true,
    "assumptions": {
      "horizonte": 7,
      "inicioOp": 1,
      "preOp": 25,
      "inflacao": 18,
      "ii": 25,
      "royalty": 0,
      "cvar": 10,
      "pessoal": 520000000,
      "fst": 160000000,
      "outros": 40000000,
      "manut": 1.5,
      "vidaManut": 5,
      "dso": 75,
      "dio": 0,
      "dpo": 30,
      "capitalInicial": 450000000,
      "payout": 40,
      "caixaMin": 60000000,
      "divida": {
        "montante": 0,
        "taxa": 19,
        "prazo": 4,
        "carencia": 0,
        "ano": 0
      },
      "wacc": {
        "modo": "capm",
        "rf": 17,
        "erp": 6,
        "beta": 1.1,
        "crp": 0,
        "kd": 19,
        "wd": 15,
        "manual": 22
      },
      "tv": {
        "metodo": "gordon",
        "g": 8,
        "mult": 6
      },
      "cov": {
        "dscr": 1.3,
        "ndEbitda": 3.5,
        "icr": 3
      },
      "mult": {
        "lo": 4,
        "hi": 7
      },
      "sens": 20,
      "cenarios": {
        "base": {
          "preco": 1,
          "volume": 1,
          "opex": 1,
          "capex": 1
        },
        "otim": {
          "preco": 1.1,
          "volume": 1.1,
          "opex": 0.95,
          "capex": 0.95
        },
        "pess": {
          "preco": 0.85,
          "volume": 0.85,
          "opex": 1.1,
          "capex": 1.15
        }
      },
      "cen": "base",
      "inicio": "greenfield",
      "abertura": {
        "imob": 0,
        "vidaRem": 8,
        "exist": 0,
        "clientes": 0,
        "caixa": 0,
        "fornec": 0,
        "divida": 0,
        "divTaxa": 12,
        "divPrazo": 4
      },
      "anoBase": 2026,
      "nome": "Empresa de consultoria e manutenção",
      "receitas": [
        {
          "nome": "Horas de consultoria",
          "unid": "horas",
          "qtd": 18000,
          "cresc": 10,
          "ramp": "60,85,100",
          "preco": 45000,
          "esc": 12
        },
        {
          "nome": "Contratos de manutenção",
          "unid": "contratos/ano",
          "qtd": 40,
          "cresc": 15,
          "ramp": "50,100",
          "preco": 9600000,
          "esc": 12
        }
      ],
      "capex": [
        {
          "nome": "Escritório e equipamento",
          "ano": 0,
          "valor": 180000000,
          "vida": 5
        },
        {
          "nome": "Software e licenças",
          "ano": 0,
          "valor": 90000000,
          "vida": 3
        }
      ]
    }
  },
  "industria": {
    "name": "Indústria transformadora",
    "description": "Unidade fabril — capacidade, custo variável, PRODESI",
    "currency": "Kz",
    "sampleOnly": true,
    "assumptions": {
      "horizonte": 10,
      "inicioOp": 1,
      "preOp": 25,
      "inflacao": 18,
      "ii": 25,
      "royalty": 0,
      "cvar": 52,
      "pessoal": 380000000,
      "fst": 420000000,
      "outros": 80000000,
      "manut": 3,
      "vidaManut": 5,
      "dso": 30,
      "dio": 45,
      "dpo": 60,
      "capitalInicial": 2200000000,
      "payout": 30,
      "caixaMin": 200000000,
      "divida": {
        "montante": 2400000000,
        "taxa": 7.5,
        "prazo": 7,
        "carencia": 2,
        "ano": 0
      },
      "wacc": {
        "modo": "capm",
        "rf": 17,
        "erp": 6,
        "beta": 1,
        "crp": 0,
        "kd": 7.5,
        "wd": 50,
        "manual": 18
      },
      "tv": {
        "metodo": "gordon",
        "g": 8,
        "mult": 6
      },
      "cov": {
        "dscr": 1.3,
        "ndEbitda": 3.5,
        "icr": 3
      },
      "mult": {
        "lo": 4,
        "hi": 7
      },
      "sens": 20,
      "cenarios": {
        "base": {
          "preco": 1,
          "volume": 1,
          "opex": 1,
          "capex": 1
        },
        "otim": {
          "preco": 1.1,
          "volume": 1.1,
          "opex": 0.95,
          "capex": 0.95
        },
        "pess": {
          "preco": 0.85,
          "volume": 0.85,
          "opex": 1.1,
          "capex": 1.15
        }
      },
      "cen": "base",
      "inicio": "greenfield",
      "abertura": {
        "imob": 0,
        "vidaRem": 8,
        "exist": 0,
        "clientes": 0,
        "caixa": 0,
        "fornec": 0,
        "divida": 0,
        "divTaxa": 12,
        "divPrazo": 4
      },
      "anoBase": 2026,
      "nome": "Fábrica de água mineral e bebidas",
      "receitas": [
        {
          "nome": "Garrafas (1,5 L)",
          "unid": "unidades",
          "qtd": 24000000,
          "cresc": 6,
          "ramp": "45,75,100",
          "preco": 150,
          "esc": 12
        }
      ],
      "capex": [
        {
          "nome": "Construção da unidade fabril",
          "ano": 0,
          "valor": 1500000000,
          "vida": 25
        },
        {
          "nome": "Linha de enchimento",
          "ano": 0,
          "valor": 2200000000,
          "vida": 12
        },
        {
          "nome": "Equipamento auxiliar e frota",
          "ano": 1,
          "valor": 600000000,
          "vida": 6
        }
      ]
    }
  },
  "imobiliario": {
    "name": "Imobiliário",
    "description": "Arrendamento — ocupação, renda por m², construção faseada",
    "currency": "USD",
    "sampleOnly": true,
    "assumptions": {
      "horizonte": 15,
      "inicioOp": 2,
      "preOp": 25,
      "inflacao": 2.5,
      "ii": 25,
      "royalty": 0,
      "cvar": 5,
      "pessoal": 180000,
      "fst": 350000,
      "outros": 120000,
      "manut": 1.5,
      "vidaManut": 5,
      "dso": 30,
      "dio": 0,
      "dpo": 30,
      "capitalInicial": 7000000,
      "payout": 60,
      "caixaMin": 300000,
      "divida": {
        "montante": 9000000,
        "taxa": 8,
        "prazo": 10,
        "carencia": 2,
        "ano": 1
      },
      "wacc": {
        "modo": "capm",
        "rf": 4.3,
        "erp": 5.5,
        "beta": 0.8,
        "crp": 7.5,
        "kd": 8,
        "wd": 50,
        "manual": 12
      },
      "tv": {
        "metodo": "multiplo",
        "g": 2,
        "mult": 9
      },
      "cov": {
        "dscr": 1.3,
        "ndEbitda": 3.5,
        "icr": 3
      },
      "mult": {
        "lo": 4,
        "hi": 7
      },
      "sens": 20,
      "cenarios": {
        "base": {
          "preco": 1,
          "volume": 1,
          "opex": 1,
          "capex": 1
        },
        "otim": {
          "preco": 1.1,
          "volume": 1.1,
          "opex": 0.95,
          "capex": 0.95
        },
        "pess": {
          "preco": 0.85,
          "volume": 0.85,
          "opex": 1.1,
          "capex": 1.15
        }
      },
      "cen": "base",
      "inicio": "greenfield",
      "abertura": {
        "imob": 0,
        "vidaRem": 8,
        "exist": 0,
        "clientes": 0,
        "caixa": 0,
        "fornec": 0,
        "divida": 0,
        "divTaxa": 12,
        "divPrazo": 4
      },
      "anoBase": 2026,
      "nome": "Edifício de escritórios para arrendamento",
      "receitas": [
        {
          "nome": "Rendas de escritórios",
          "unid": "m² arrendáveis",
          "qtd": 8000,
          "cresc": 0,
          "ramp": "55,80,92",
          "preco": 385,
          "esc": 2.5
        }
      ],
      "capex": [
        {
          "nome": "Construção — fase 1",
          "ano": 0,
          "valor": 9000000,
          "vida": 40
        },
        {
          "nome": "Construção — fase 2",
          "ano": 1,
          "valor": 6000000,
          "vida": 40
        },
        {
          "nome": "AVAC, elevadores e sistemas",
          "ano": 1,
          "valor": 2200000,
          "vida": 15
        }
      ]
    }
  },
  "tecnologia": {
    "name": "Tecnologia & Telecom",
    "description": "SaaS, subscritores, crescimento acelerado",
    "currency": "Kz",
    "sampleOnly": true,
    "assumptions": {
      "horizonte": 7,
      "inicioOp": 1,
      "preOp": 25,
      "inflacao": 18,
      "ii": 25,
      "royalty": 0,
      "cvar": 15,
      "pessoal": 420000000,
      "fst": 180000000,
      "outros": 60000000,
      "manut": 4,
      "vidaManut": 5,
      "dso": 30,
      "dio": 0,
      "dpo": 30,
      "capitalInicial": 900000000,
      "payout": 0,
      "caixaMin": 80000000,
      "divida": {
        "montante": 0,
        "taxa": 19,
        "prazo": 4,
        "carencia": 0,
        "ano": 0
      },
      "wacc": {
        "modo": "capm",
        "rf": 17,
        "erp": 6,
        "beta": 1.4,
        "crp": 0,
        "kd": 19,
        "wd": 10,
        "manual": 25
      },
      "tv": {
        "metodo": "gordon",
        "g": 8,
        "mult": 8
      },
      "cov": {
        "dscr": 1.3,
        "ndEbitda": 3.5,
        "icr": 3
      },
      "mult": {
        "lo": 4,
        "hi": 7
      },
      "sens": 20,
      "cenarios": {
        "base": {
          "preco": 1,
          "volume": 1,
          "opex": 1,
          "capex": 1
        },
        "otim": {
          "preco": 1.1,
          "volume": 1.1,
          "opex": 0.95,
          "capex": 0.95
        },
        "pess": {
          "preco": 0.85,
          "volume": 0.85,
          "opex": 1.1,
          "capex": 1.15
        }
      },
      "cen": "base",
      "inicio": "greenfield",
      "abertura": {
        "imob": 0,
        "vidaRem": 8,
        "exist": 0,
        "clientes": 0,
        "caixa": 0,
        "fornec": 0,
        "divida": 0,
        "divTaxa": 12,
        "divPrazo": 4
      },
      "anoBase": 2026,
      "nome": "Plataforma digital B2B (SaaS)",
      "receitas": [
        {
          "nome": "Subscrições empresariais",
          "unid": "clientes",
          "qtd": 300,
          "cresc": 35,
          "ramp": "100",
          "preco": 1200000,
          "esc": 12
        }
      ],
      "capex": [
        {
          "nome": "Desenvolvimento da plataforma",
          "ano": 0,
          "valor": 350000000,
          "vida": 4
        },
        {
          "nome": "Infra-estrutura e equipamento",
          "ano": 0,
          "valor": 80000000,
          "vida": 4
        }
      ]
    }
  }
};
export function financialTemplate(sector: FinancialSector) {
  const template = TEMPLATES[sector];
  if (!template) throw new FinancialModelError([{path:'sector', message:'Sector inválido'}]);
  return {sector, name:template.name, description:template.description, currency:template.currency, sampleOnly:true, assumptions:validateFinancialAssumptions(template.assumptions)};
}
