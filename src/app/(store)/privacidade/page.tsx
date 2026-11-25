import type { Metadata } from "next";
import { Suspense } from "react";
import { getStoreSettings } from "@/modules/store/data";
import { whatsappLink } from "@/modules/store/domain";

export const metadata: Metadata = { title: "Política de privacidade", alternates: { canonical: "/privacidade" } };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 md:px-6">
      <h1 className="mb-6 font-display text-4xl">Política de privacidade</h1>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-muted" />}>
        <Policy />
      </Suspense>
    </main>
  );
}

async function Policy() {
  const s = await getStoreSettings();
  const name = s?.company_name ?? "Kairós";
  const wa = whatsappLink(s?.whatsapp, "Olá! Quero falar sobre meus dados pessoais (LGPD).");
  return (
    <div className="space-y-5 text-sm leading-relaxed [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-2xl [&_li]:ml-5 [&_li]:list-disc">
      <p>
        Esta política explica como a <strong>{name}</strong> trata os dados pessoais de quem compra na loja virtual, conforme a Lei
        Geral de Proteção de Dados (Lei nº 13.709/2018).
      </p>

      <h2>Quais dados coletamos</h2>
      <ul>
        <li>Nome, e-mail e WhatsApp, para identificar o pedido e falar com você sobre ele.</li>
        <li>CPF, somente se você informar (para emissão de nota fiscal).</li>
        <li>Endereço, somente quando você escolhe entrega.</li>
        <li>Os produtos e valores de cada pedido.</li>
      </ul>
      <p>
        Não guardamos o seu endereço IP: para evitar abusos, usamos apenas uma versão cifrada e temporária dele no momento da
        compra. O carrinho fica salvo apenas no seu aparelho.
      </p>

      <h2>Para que usamos</h2>
      <ul>
        <li>Processar, cobrar e entregar o seu pedido (execução de contrato).</li>
        <li>Cumprir obrigações legais e fiscais.</li>
        <li>Enviar novidades e promoções, apenas se você autorizar (consentimento). Você pode cancelar quando quiser.</li>
      </ul>

      <h2>Com quem compartilhamos</h2>
      <p>
        Não vendemos dados. Eles ficam armazenados em provedores de infraestrutura contratados para hospedar o sistema (banco de
        dados e servidores) e, quando houver pagamento online, com a instituição de pagamento responsável pela cobrança. Também
        podemos informar dados quando exigido por lei ou autoridade.
      </p>

      <h2>Por quanto tempo</h2>
      <p>
        Mantemos os dados enquanto forem necessários para o pedido e pelo prazo exigido pela legislação fiscal. Dados usados para
        marketing são mantidos até você revogar a autorização.
      </p>

      <h2>Seus direitos</h2>
      <p>
        Você pode pedir a qualquer momento: confirmação e acesso aos seus dados, correção, cópia (portabilidade), revogação de
        consentimentos e anonimização ou eliminação do que não precisarmos guardar por lei.
      </p>
      <p>
        Para isso, fale com a {name}
        {wa ? (
          <>
            {" "}
            pelo{" "}
            <a href={wa} target="_blank" rel="noopener noreferrer" className="underline">
              WhatsApp
            </a>
          </>
        ) : null}
        . Responderemos no prazo previsto em lei.
      </p>
    </div>
  );
}
