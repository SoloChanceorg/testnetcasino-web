#!/usr/bin/env python3
"""
Builds legal/terms-of-service.pdf and legal/privacy-policy.pdf for TestnetCasino.com.

The text below is the source of truth: edit it here, then rebuild.
Needs Python 3.10+ with reportlab:

    python3 -m venv /tmp/pdfenv && /tmp/pdfenv/bin/pip install reportlab
    /tmp/pdfenv/bin/python tools/legal/build_legal.py

Bump EFFECTIVE when the content changes. User-facing text never uses em dashes.
"""
import os
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer, KeepTogether

EFFECTIVE = "11 November 2026"
CONTACT = "house@testnetcasino.com"
SITE = "TestnetCasino.com"
HOUSE = "bchtest:qphp0rfnp6uyjfh5p235r8lwykv6knknfqqw5ghdxy"

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "legal")

GOLD = HexColor("#a87a12")
INK = HexColor("#1b1b1b")
MUTED = HexColor("#555555")

ST = {
    "title": ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=INK, alignment=TA_CENTER, spaceAfter=4),
    "sub": ParagraphStyle("sub", fontName="Helvetica", fontSize=9.5, leading=13, textColor=MUTED, alignment=TA_CENTER, spaceAfter=14),
    "box": ParagraphStyle("box", fontName="Helvetica-Bold", fontSize=9.5, leading=13.5, textColor=INK, borderColor=GOLD, borderWidth=1,
                          borderPadding=8, backColor=HexColor("#fff7e0"), spaceBefore=4, spaceAfter=14),
    "h": ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=GOLD, spaceBefore=10, spaceAfter=4),
    "p": ParagraphStyle("p", fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=INK, spaceAfter=5),
    "li": ParagraphStyle("li", fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=INK),
    "caps": ParagraphStyle("caps", fontName="Helvetica-Bold", fontSize=9, leading=13, textColor=INK, spaceAfter=5),
}


def bullets(items):
    return ListFlowable([ListItem(Paragraph(t, ST["li"]), leftIndent=12) for t in items],
                        bulletType="bullet", start="•", leftIndent=12, bulletFontSize=8, spaceAfter=5)


def build(filename, title, intro_box, sections):
    path = os.path.join(OUT, filename)

    def page(c, doc):
        c.saveState()
        c.setFont("Helvetica", 8)
        c.setFillColor(MUTED)
        c.drawString(18 * mm, 10 * mm, f"{SITE} · {title} · Effective {EFFECTIVE}")
        c.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {doc.page}")
        c.restoreState()

    doc = SimpleDocTemplate(path, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
                            title=f"{title} | {SITE}", author=f"{SITE} (a SoloChance.org project)", subject=title,
                            creator="tools/legal/build_legal.py")
    story = [Paragraph(title, ST["title"]),
             Paragraph(f"{SITE} · a SoloChance.org project · Effective {EFFECTIVE}", ST["sub"]),
             Paragraph(intro_box, ST["box"])]
    for i, (head, blocks) in enumerate(sections, 1):
        first = [Paragraph(f"{i}. {head}", ST["h"])]
        rest = []
        for b in blocks:
            if isinstance(b, list):
                rest.append(bullets(b))
            elif b.startswith("CAPS:"):
                rest.append(Paragraph(b[5:], ST["caps"]))
            else:
                rest.append(Paragraph(b, ST["p"]))
        story.append(KeepTogether(first + rest[:1]))
        story.extend(rest[1:])
    story.append(Spacer(1, 10))
    story.append(Paragraph(f"Questions about this document: <b>{CONTACT}</b>", ST["sub"]))
    doc.build(story, onFirstPage=page, onLaterPages=page)
    return path


# ═══════════════════════════════ TERMS OF SERVICE ═══════════════════════════════

TERMS_BOX = (
    "TestnetCasino.com is NOT a casino and NOT gambling. It is a free faucet for Bitcoin Cash Testnet4 test coins (tBCH), "
    "presented as slot machine games for fun and education. There are no deposits and no real money of any kind. tBCH have "
    "NO monetary value and cannot be exchanged for money. You must be 18 or older. The service is provided AS IS, without any "
    "warranty, and our liability is excluded to the maximum extent permitted by law. If you do not agree, do not use the service."
)

TERMS = [
    ("Agreement", [
        f"These Terms of Service (the \"Terms\") govern your access to and use of {SITE}, its subdomains, its API at "
        "api.testnetcasino.com, and all related pages, games, features and content (together, the \"Service\").",
        "By accessing or using the Service in any way, including browsing it, signing in or playing, you confirm that you have "
        "read, understood and accept these Terms and our Privacy Policy. If you do not accept them, you must not use the Service.",
    ]),
    ("Who we are", [
        "The Service is a SoloChance.org project operated by a private individual based in the Republic of Estonia "
        f"(\"we\", \"us\", \"our\"). You can contact us at <b>{CONTACT}</b>.",
    ]),
    ("What the Service is, and what it is not", [
        "The Service is a faucet for Bitcoin Cash Testnet4 coins (\"tBCH\", also counted in \"tSats\"; 1 tBCH = 100,000,000 tSats). "
        "Bitcoin Cash Testnet4 is a public test network that exists so developers can test Bitcoin Cash software. Its coins are free and "
        "worthless by design. The Service hands them out through slot machine style games, for entertainment and education only.",
        [
            "The Service is <b>not a casino, not a gambling service, not a lottery and not a game of chance for value</b>. "
            "Nothing of value can be staked, and nothing of value can be won.",
            "<b>There is no deposit of any kind</b>, not even of tBCH. You cannot buy credits, top up a balance or pay us.",
            "<b>tBCH have no monetary value</b>. They are not money, not legal tender, not an investment, not a security, not a "
            "financial instrument and not a crypto-asset with any market value. They cannot be redeemed, exchanged or sold for "
            "money, mainnet Bitcoin Cash, Bitcoin or anything else of value, by us or through us.",
            "No mainnet cryptocurrency (Bitcoin, Bitcoin Cash or any other) is ever paid out by the Service.",
            "Words such as \"casino\", \"bet\", \"win\", \"jackpot\", \"RTP\" and \"house\" are used for theme and entertainment only.",
        ],
    ]),
    ("Eligibility", [
        "You must be at least <b>18 years old</b> (or the age of majority where you live, if higher) to use the Service. "
        "By using it you confirm that you are.",
        "You are solely responsible for making sure that using the Service is lawful where you are. Do not use the Service "
        "where it, or anything resembling it, is prohibited or restricted. We may block, limit or refuse access from any "
        "country, region, network or person, at any time and without giving reasons.",
    ]),
    ("Your account", [
        "You sign in with a Bitcoin Cash Testnet4 wallet (by signing a message) or with a passkey. There are no passwords. "
        "<b>We will never ask for your private key, seed phrase or password.</b> Anyone who does is not us.",
        [
            "One account per person. Creating or controlling more than one account is not allowed.",
            "You are responsible for your wallet, your keys, your passkeys and your devices, and for everything done with "
            "your account. We cannot recover a lost passkey or a lost wallet.",
            "Accounts are personal and may not be sold, transferred, shared or rented.",
        ],
    ]),
    ("Balances and test coins", [
        "Your balance is an entry in our records, counted in tSats. It is not a deposit, not a claim against us and not your "
        "property. It only reflects test coins that we may, at our discretion, send to a Bitcoin Cash Testnet4 address you choose.",
        "We may, at any time and without notice or liability, correct, adjust, reverse, freeze, cap, reset or remove any "
        "balance, bonus, win or ledger entry, in particular after an error, bug, outage, misuse, suspected abuse, a change or "
        "reset of the Bitcoin Cash Testnet4 network, or to keep the faucet available to others. Outcomes produced by a malfunction are void.",
        "The Bitcoin Cash Testnet4 network can be reset, forked, abandoned or replaced by its developers at any time. If that happens, "
        "balances and coins may be lost or become unusable. We are not responsible for it.",
    ]),
    ("Bonuses", [
        "Sign-up bonuses, daily bonuses and any other bonus are gifts of test coins. We may change their amount, timing and "
        "conditions, or stop them, at any time without notice. One bonus per person where a limit applies.",
    ]),
    ("Games, fairness and results", [
        "Every spin is decided on our server with a provably fair system that you can verify on the fairness page. The "
        "published return to player (RTP) of 100.01% is a long-run statistical average and not a promise for any session, "
        "spin, period or player. Results are random: you may lose your whole test balance quickly.",
        "The server's recorded result is final. If what you see on screen differs from the server's record (for example "
        "because of a display error, animation, connection problem or browser issue), the server's record prevails. We may "
        "change, remove or add games, paytables, features, limits and odds at any time.",
    ]),
    ("Withdrawals", [
        "Withdrawals send tBCH on the Bitcoin Cash Testnet4 network to the address you provide. They are a courtesy, not an obligation.",
        [
            "Limits apply (currently 1,000 to 10,000,000 tSats per withdrawal, 100,000,000 tSats (1 tBCH) per player in 24 hours and "
            "10 tBCH a day for the whole faucet) and may change at any time.",
            "We may disable, pause, delay, limit, refuse or cancel withdrawals at any time, for any reason or none.",
            "<b>You are solely responsible for the address you enter.</b> Blockchain transactions cannot be reversed. Coins sent "
            "to a wrong, mistyped, mainnet or unusable address are lost, and we will not replace them.",
            "We do not guarantee that a withdrawal is sent, confirmed or received, or how long it takes. A withdrawal that fails "
            "permanently is returned to your balance.",
        ],
    ]),
    ("Coins sent to us and donations", [
        f"Test coins you send to the house address ({HOUSE}) or to any other address of ours are voluntary returns to the "
        "faucet. They are not deposits, do not add to your balance and are not refundable.",
        "Donations in mainnet Bitcoin or Bitcoin Cash to the addresses shown on the Service are voluntary gifts to support the "
        "project. They are final and non-refundable, give no right, credit, benefit or advantage in the Service, and are not "
        "payment for anything. Donations are entirely separate from the games.",
    ]),
    ("Things you must not do", [
        "You must not, and must not help others to:",
        [
            "use bots, scripts, automation or any non-human means to play, claim bonuses or withdraw;",
            "create or use multiple accounts, or get around limits, rate limits, blocks or bans (including with VPNs or proxies);",
            "exploit, or fail to report, a bug, error or vulnerability, or try to predict, influence or tamper with results;",
            "attack, overload, probe, scan, scrape or reverse engineer the Service or its infrastructure;",
            "sell, buy, trade or offer tBCH, balances or accounts for money or anything of value, or present the Service as gambling;",
            "use the Service for anything unlawful, fraudulent, abusive or harmful, or in breach of these Terms.",
        ],
        "If we suspect any of this, we may suspend or close accounts and remove balances, without notice or liability.",
    ]),
    ("Responsible play and health", [
        "The Service is meant as harmless fun with worthless test coins. It is not intended to encourage gambling, and it "
        "shows that even a machine paying back more than 100% can empty a balance fast. <b>If you have, or have had, a "
        "gambling problem, or are at risk of one, do not use the Service</b>, and consider seeking help from a professional "
        "or a support service. You use the Service at your own risk, and we accept no responsibility for any effect it has on "
        "your behaviour, health or wellbeing.",
    ]),
    ("No advice", [
        "Nothing on the Service is financial, investment, legal, tax or other professional advice. Information about "
        "Bitcoin Cash Testnet4, mining, wallets, fairness or anything else is general and educational, may be incomplete or out of date, "
        "and you should not rely on it.",
    ]),
    ("Third parties", [
        "The Service relies on, links to or works with services we do not control, including the Bitcoin Cash Testnet4 "
        "network, its nodes and miners, block explorers (such as bchexplorer.cash), wallets, Cloudflare, GitHub Pages, Google "
        "Fonts and the test mining pools that supply coins. We are not responsible for their availability, content, security, "
        "privacy practices or actions, and your use of them is at your own risk and under their terms.",
    ]),
    ("Intellectual property", [
        "The Service, its design, code, text, graphics, sounds, music and names belong to us or our licensors. You may use "
        "the Service only as allowed by these Terms. Emoji and fonts are used under their providers' licences.",
    ]),
    ("Disclaimer of warranties", [
        "CAPS:THE SERVICE IS PROVIDED \"AS IS\" AND \"AS AVAILABLE\", WITH ALL FAULTS AND WITHOUT WARRANTIES OF ANY KIND, WHETHER "
        "EXPRESS, IMPLIED OR STATUTORY, INCLUDING ANY WARRANTY OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, "
        "NON-INFRINGEMENT, ACCURACY, AVAILABILITY, SECURITY OR UNINTERRUPTED OR ERROR-FREE OPERATION. WE DO NOT WARRANT THAT ANY "
        "BALANCE, RESULT, BONUS, WITHDRAWAL, TRANSACTION OR DATA WILL BE CORRECT, KEPT OR DELIVERED.",
        "The Service is a hobby project offered free of charge. It may contain bugs, change, be interrupted or end at any time, "
        "with or without notice.",
    ]),
    ("Limitation of liability", [
        "CAPS:TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, WE ARE NOT LIABLE FOR ANY LOSS OR DAMAGE OF ANY KIND ARISING OUT OF "
        "OR IN CONNECTION WITH THE SERVICE OR THESE TERMS, INCLUDING ANY LOSS OF TEST COINS, BALANCES, DATA, PROFITS, REVENUE, "
        "OPPORTUNITY OR GOODWILL, AND ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY OR PUNITIVE DAMAGES, WHETHER IN "
        "CONTRACT, TORT (INCLUDING NEGLIGENCE) OR OTHERWISE, EVEN IF WE WERE TOLD THEY WERE POSSIBLE.",
        "Where liability cannot be excluded, our total liability for all claims together is limited to <b>ten euros (EUR 10)</b>. "
        "Test coins and balances are worth nothing and are never compensated.",
        "Nothing in these Terms excludes or limits liability that cannot be excluded or limited by law, such as liability for "
        "intent or gross negligence where the law does not allow it, or your mandatory rights as a consumer.",
    ]),
    ("Indemnity", [
        "To the extent permitted by law, you agree to defend, indemnify and hold us harmless from any claim, loss, liability, "
        "damage, cost or expense (including reasonable legal fees) arising from your use of the Service, your breach of these "
        "Terms or of any law, or your violation of any third party's rights.",
    ]),
    ("Suspension and termination", [
        "We may suspend, limit or close your account, or end your access to the Service, at any time, for any reason or none, "
        "with or without notice. You may stop using the Service at any time. Sections that by their nature should survive "
        "(including 3, 6, 9 to 13 and 16 to 22) survive termination. When an account is closed, its balance is not paid out.",
    ]),
    ("Changes", [
        "We may change, suspend or discontinue the Service, or any part of it, at any time. We may update these Terms at any "
        "time by publishing a new version with a new effective date. Continuing to use the Service after that means you "
        "accept the new version.",
    ]),
    ("Governing law and disputes", [
        "These Terms and any dispute arising from them or from the Service are governed by the laws of the Republic of Estonia, "
        "without regard to conflict of law rules. The courts of Estonia have exclusive jurisdiction, unless mandatory consumer "
        "protection law where you live gives you the right to bring a claim in your own courts. Please contact us first: most "
        "questions can be solved by email.",
    ]),
    ("General", [
        "If any part of these Terms is found invalid or unenforceable, the rest remains in effect and the invalid part is "
        "replaced by the valid provision closest to its intent. Our failure to enforce a right is not a waiver. You may not "
        "transfer your rights under these Terms; we may transfer ours. These Terms and the Privacy Policy are the entire "
        "agreement between you and us about the Service. The English version is the only binding version.",
    ]),
    ("Contact", [
        f"Questions, notices or reports about these Terms: <b>{CONTACT}</b>.",
    ]),
]

# ═══════════════════════════════ PRIVACY POLICY ═══════════════════════════════

PRIVACY_BOX = (
    "We collect as little as possible. There are no names, emails, passwords, payment details or advertising trackers. "
    "To run accounts, games and withdrawals we store your Bitcoin Cash Testnet4 wallet address or passkey public key, your activity in "
    "the Service, and the IP addresses used to create accounts and sign in (to prevent abuse). Withdrawals are public on "
    "the blockchain forever. We do not sell your data."
)

PRIVACY = [
    ("Who is responsible", [
        f"The controller of your personal data is the operator of {SITE}, a SoloChance.org project run by a private "
        f"individual based in the Republic of Estonia. Contact for any privacy matter: <b>{CONTACT}</b>.",
        "This policy explains what personal data the Service processes, why, on what legal basis, for how long, who receives "
        "it and what your rights are under the EU General Data Protection Regulation (GDPR) and Estonian law.",
    ]),
    ("Data we process", [
        "<b>Account data.</b> For wallet accounts: your Bitcoin Cash Testnet4 address and the signed sign-in messages we check. For passkey "
        "accounts: the passkey's public key and credential identifier, a random user handle and the data your browser returns "
        "when you use the passkey (we never see your fingerprint, face or device PIN). For both: an internal account id, the "
        "date the account was created and whether it is enabled.",
        "<b>Game and balance data.</b> Every spin (game, bet, result, time), your fairness seeds and nonces, and an append-only "
        "ledger of every change to your balance (sign-up and daily bonuses, spins, withdrawals, corrections).",
        "<b>Withdrawal data.</b> The amount, the Bitcoin Cash Testnet4 address you enter, the status and the blockchain transaction id. "
        "Passkey accounts may also save a default withdrawal address.",
        "<b>Network and security data.</b> The IP address an account was created from and the IP address of sign-in "
        "challenges, used together with your network range (IPv4 /24, IPv6 /64) for rate limits and to stop mass account "
        "creation. An audit log records administrative actions and certain security events, which may include an IP address. "
        "Our servers also keep technical logs (time, requested address, status, errors); they never contain your seeds, "
        "signatures or cookies.",
        "<b>Session cookie.</b> One strictly necessary cookie, <i>__Host-session</i> (HttpOnly, Secure), keeps you signed in. "
        "It holds a random identifier only.",
        "<b>Browser storage.</b> Your browser stores display preferences on your device only: the tSats/tBCH switch, sound on "
        "or off, jukebox settings and your last bet per game. They are not sent to us.",
        "We do not ask for or process names, email addresses, phone numbers, physical addresses, payment data, identity "
        "documents or special categories of data. We do not use advertising, analytics or tracking cookies.",
    ]),
    ("Why we use it, and the legal basis", [
        [
            "<b>To provide the Service</b> (accounts, sign-in, games, balances, bonuses, withdrawals, history, leaderboards): "
            "performance of our agreement with you (GDPR Art. 6(1)(b)).",
            "<b>To keep the Service secure and fair</b> (rate limits, one account per person, preventing fraud, bots and abuse, "
            "investigating incidents, auditing administrative actions, fixing errors): our legitimate interest in protecting "
            "the Service, the faucet's coins and other players (Art. 6(1)(f)).",
            "<b>To keep a complete, verifiable ledger</b> and prove the fairness and integrity of results: our legitimate "
            "interest (Art. 6(1)(f)).",
            "<b>To comply with the law</b> and respond to lawful requests: legal obligation (Art. 6(1)(c)).",
            "<b>Session cookie and browser preferences</b>: strictly necessary for the service you ask for, so no consent is "
            "needed for them.",
        ],
        "We do not make decisions with legal or similarly significant effects about you based solely on automated processing. "
        "Automatic rate limits and limits on withdrawals only protect the Service.",
    ]),
    ("Public information", [
        "<b>Leaderboards</b> show a public label for each listed player together with amounts (balance, net winnings or "
        "withdrawals). The label is a shortened wallet address (for example bchtest:qz8f...4k2m) or \"Passkey\" with six "
        "characters derived from the account. It is not your name.",
        "<b>The blockchain is public and permanent.</b> Every withdrawal is a Bitcoin Cash Testnet4 transaction that anyone can see, "
        "including the address and amount, and it cannot be changed or deleted by anyone, including us. Your wallet address "
        "is also visible on the blockchain whenever you use it. Avoid reusing an address you want to keep private.",
        "<b>Fairness data.</b> Revealed server seeds and spin details are shown to you so you can verify results.",
    ]),
    ("Who receives your data", [
        "We do not sell, rent or share your personal data for marketing. We use these processors and services:",
        [
            "<b>Cloudflare, Inc.</b> (United States, global network): DNS, TLS and proxy in front of our API. It processes IP "
            "addresses and request data to deliver and protect traffic.",
            "<b>Our hosting provider</b> (data centre in the Netherlands): runs the API server and the database.",
            "<b>GitHub, Inc.</b> (United States): hosts the website's static files (GitHub Pages) and may log visitor IP "
            "addresses.",
            "<b>Google LLC</b> (United States): Google Fonts are loaded from Google's servers, which receive your IP address and "
            "browser details when a page loads.",
            "<b>The Bitcoin Cash Testnet4 network</b>: withdrawals are broadcast publicly to its nodes and miners.",
        ],
        "Links to other sites, such as block explorers and the test mining pools, take you to services with their own privacy "
        "policies. We may also disclose data when required by law or to protect our rights, the Service or others.",
    ]),
    ("International transfers", [
        "Some providers above are based in, or may process data in, countries outside the European Economic Area, including "
        "the United States. Such transfers rely on an adequacy decision (such as the EU-US Data Privacy Framework, where the "
        "provider is certified) or the European Commission's standard contractual clauses offered by the provider.",
    ]),
    ("How long we keep data", [
        [
            "Account, game, ledger and withdrawal data: for as long as the account exists. The ledger is append-only by design, "
            "so that every balance can be verified; entries are kept after an account is disabled for as long as needed for "
            "integrity, fairness verification, fraud prevention and legal claims.",
            "Sessions: until you sign out or 30 days after your last request.",
            "Sign-in challenges, including their IP address: valid for 5 minutes and deleted automatically one day after "
            "they expire.",
            "The IP address an account was created from, and audit log entries: for as long as needed to prevent abuse and "
            "to investigate incidents, and deleted or anonymised when no longer needed.",
            "Technical server logs: only as long as needed for operation and security, then rotated out.",
            "Blockchain transactions: permanent and outside our control.",
        ],
    ]),
    ("Your rights", [
        "Under the GDPR you have the right to access your data, to have it corrected, to have it erased, to restrict or object "
        "to processing based on legitimate interests, and to data portability. To use these rights, email "
        f"<b>{CONTACT}</b> from any address and tell us your account's wallet address or passkey label; we may ask you to prove "
        "that the account is yours, for example by signing a message with your wallet.",
        "Some data cannot be erased: blockchain transactions are permanent, and ledger and security records may need to be "
        "kept as explained above. In that case we will disable the account, stop using the data for anything else, and delete "
        "or anonymise whatever we can. Erasing or disabling an account ends access to its balance.",
        "You also have the right to lodge a complaint with a supervisory authority, in Estonia the Data Protection "
        "Inspectorate (Andmekaitse Inspektsioon, www.aki.ee), or the authority where you live or work.",
    ]),
    ("Security", [
        "We protect data with measures such as encrypted connections (HTTPS), an HttpOnly session cookie, a firewall that only "
        "accepts traffic from our proxy, access controls and an append-only ledger. No system is perfectly secure, and we "
        "cannot guarantee absolute security. Keep your wallet keys and passkeys safe: we never ask for them.",
    ]),
    ("Children", [
        "The Service is only for people aged 18 or older. We do not knowingly process data of anyone younger. If you believe a "
        f"minor has used the Service, contact {CONTACT} and we will disable the account.",
    ]),
    ("Changes to this policy", [
        "We may update this policy at any time by publishing a new version with a new effective date. If the changes are "
        "significant, we will make that clear on the Service.",
    ]),
    ("Contact", [
        f"For any question or request about your personal data: <b>{CONTACT}</b>.",
    ]),
]


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for f in (build("terms-of-service.pdf", "Terms of Service", TERMS_BOX, TERMS),
              build("privacy-policy.pdf", "Privacy Policy", PRIVACY_BOX, PRIVACY)):
        print("wrote", os.path.relpath(f, ROOT))
