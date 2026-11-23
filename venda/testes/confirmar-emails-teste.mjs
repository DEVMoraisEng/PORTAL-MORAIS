/* 23/11/2026: o Enviar só segue depois da tela de confirmar os e-mails (assinaturaSignatarios + deps.confirmarEmails).
 * Os testes antigos do Enviar falam de outras coisas (prazo, rubricas, faltas, demora) — este embrulho faz a confirmação
 * por eles, do jeito que a tela faria: pede a lista (fora do registro de chamadas do teste) e confirma com os e-mails do
 * cadastro quando o deps.confirmar do teste diz sim. O texto passado ao confirmar imita a pergunta antiga, para os testes
 * do prazo e do termo continuarem conferindo que a data e o documento chegam na confirmação.
 * Testes da própria confirmação chamam o original (A.executarAcaoAssinaturaOriginal) com deps.confirmarEmails próprio.
 * Só dados inventados — o repositório é público. */
export const SIGS_TESTE = [{ papel: "Comprador 1", nome: "Fulano de Teste", email: "fulano@teste.example" }];
export const EMAILS_TESTE = { "Comprador 1": "fulano@teste.example" };

export function embrulharConfirmacao(A) {
  if (A.executarAcaoAssinaturaOriginal) return A;
  const original = A.executarAcaoAssinatura;
  A.executarAcaoAssinaturaOriginal = original;
  A.executarAcaoAssinatura = (acao, c, deps) => {
    if (!deps || deps.confirmarEmails) return original(acao, c, deps);
    const d = Object.assign({}, deps, {
      chamar: (p) => (p && p.action === "assinaturaSignatarios"
        ? Promise.resolve({ ok: true, signatarios: SIGS_TESTE })
        : deps.chamar(p)),
      confirmarEmails: async (o) => {
        const ok = typeof deps.confirmar === "function"
          ? deps.confirmar("Enviar o " + (o.termo ? "termo de reserva" : "contrato") + " para assinatura até " + o.prazo + "?")
          : true;
        return ok ? Object.assign({}, EMAILS_TESTE) : null;
      },
    });
    return original(acao, c, d);
  };
  return A;
}
