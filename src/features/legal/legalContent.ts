// Legal documents shown in the app (Terms of Service, Privacy Policy). Plain English, no third-party names.

export type LegalKind = 'terms' | 'privacy';

export interface LegalSection {
  title: string;
  paras?: string[];
  bullets?: string[];
}

export interface LegalDoc {
  title: string;
  tagline: string;
  updated: string;
  highlights: string[];
  intro: string[];
  sections: LegalSection[];
}

export const LEGAL_VERSION = '2026-11-03';
const UPDATED = 'November 3, 2026';
const SUPPORT = 'support@beetook.com';

const TERMS: LegalDoc = {
  title: 'Terms of Service',
  tagline: 'The rules of the hive: what you can expect from us, and what we expect from you.',
  updated: UPDATED,
  highlights: [
    'You must be old enough to use Bee Took and keep your account secure.',
    'You own your content, and you give us the permission we need to show it in the app.',
    'Be respectful. No harassment, hate, illegal content, scams or harm to minors.',
    'Coins and gifts are virtual items with no cash value, except where we clearly say otherwise.',
    'We may act on accounts that break these rules, and you can leave at any time.',
  ],
  intro: [
    'Welcome to Bee Took. These Terms of Service (the "Terms") form a legally binding agreement between you and Bee Took ("Bee Took", "we", "us" or "our"). They govern your access to and use of our mobile application, live rooms, short videos, messaging, wallet, Partner program and every related feature (together, the "Service").',
    'Please read them carefully. By ticking the agreement box, creating an account, or using the Service, you confirm that you have read, understood and agreed to these Terms and to our Privacy Policy. If you do not agree, please do not use the Service.',
  ],
  sections: [
    {
      title: 'Eligibility',
      paras: [
        'You may use the Service only if you can form a binding contract with us and you are not barred from using it under the laws that apply to you.',
      ],
      bullets: [
        'You must be at least 13 years old, or the minimum age required in your country if it is higher.',
        'If you are under 18, you confirm that a parent or legal guardian has reviewed these Terms and permits your use of the Service.',
        'Some features, such as live broadcasting, gifting, redemption and the Partner program, may require a higher age or additional checks.',
        'You must not use the Service if we have previously suspended or removed your account, unless we have allowed you to return in writing.',
      ],
    },
    {
      title: 'Your account',
      paras: ['To use many features you need an account. You agree to keep it accurate, secure and under your control.'],
      bullets: [
        'Provide truthful information, such as your name, phone number and email address, and keep it up to date.',
        'Keep your password and verification codes private. Anything done through your account is treated as done by you.',
        'Tell us immediately at ' + SUPPORT + ' if you suspect unauthorized access.',
        'One person may not run many accounts to mislead others, avoid a restriction, or manipulate rankings, gifts or rewards.',
        'Accounts are personal. You may not sell, rent, transfer or share your account without our written permission.',
      ],
    },
    {
      title: 'Your content and the license you give us',
      paras: [
        'You keep ownership of the videos, photos, captions, comments, messages, sounds and other material you post ("Your Content"). You are responsible for it.',
        'To run the Service, you grant Bee Took a worldwide, non-exclusive, royalty-free, transferable and sublicensable license to host, store, reproduce, adapt (for example, resize, compress or add captions), display, distribute and perform Your Content in and through the Service, including for promotion of the Service and your profile. This license lasts while your content is on the Service and for a reasonable period afterwards while copies remain in backups or in the hands of other users who shared it.',
        'You confirm that you own Your Content or have every permission, license and consent needed to post it, including from people who appear in it and from owners of any music, images or other material in it.',
      ],
    },
    {
      title: 'Community standards',
      paras: ['Bee Took is a place for creativity and connection. When you use the Service, you agree not to post, stream, send or promote anything that:'],
      bullets: [
        'is illegal, fraudulent, deceptive or misleading, including scams, fake giveaways and impersonation;',
        'harasses, bullies, threatens, stalks or targets any person or group, or incites violence or hatred based on race, ethnicity, religion, gender, disability, age or other protected traits;',
        'contains sexual content involving minors, or sexualizes or endangers minors in any way. We have zero tolerance and will report such content to the authorities;',
        'contains nudity, explicit sexual activity, graphic violence, self-harm promotion, or dangerous acts that could lead to injury;',
        'promotes terrorism, criminal organizations, illegal drugs, weapons trafficking or human exploitation;',
        'infringes the intellectual property, privacy or publicity rights of others;',
        'shares private information of others without consent, including recordings made without required permission;',
        'spreads malware, spam, or unsolicited bulk messages, or interferes with how the Service works;',
        'tries to manipulate views, followers, gifts, ratings or rewards by automated, deceptive or abusive means.',
      ],
    },
    {
      title: 'Live streaming and interactions',
      paras: [
        'Live rooms are real-time and public by default unless a feature states otherwise. Hosts are responsible for everything they broadcast and for the conduct they allow in their rooms. Viewers are responsible for what they say and send.',
      ],
      bullets: [
        'Do not broadcast in places or situations where recording is prohibited or where you could endanger yourself or others.',
        'Hosts may remove, mute or block participants in their rooms, and must follow our Community standards at all times.',
        'We may interrupt, limit or end a live room, and restrict access to live features, if we reasonably believe the rules are being broken.',
        'You must not record, copy or redistribute another person\'s live broadcast in a way that violates their rights or the law.',
      ],
    },
    {
      title: 'Coins, gifts and purchases',
      paras: [
        'The Service lets you buy virtual coins and use them to send virtual gifts, unlock features and support creators. Coins and gifts are limited licenses to use virtual items inside Bee Took.',
      ],
      bullets: [
        'Coins have no cash value, are not legal tender, and are not a bank deposit, stored value or investment.',
        'Coins are bought through the payment options shown in the app. Prices, taxes and available methods may vary by location and may change.',
        'Payments are handled by licensed payment processors and app stores. Their terms also apply to your purchase.',
        'Once a gift is sent, it cannot be taken back. Purchases are generally final, except where the law gives you a right to a refund or where we decide to grant one.',
        'We may correct balance errors, reverse transactions that result from fraud, chargebacks, technical faults or violations of these Terms, and suspend balances while we investigate.',
        'If a payment is delayed, our systems may take time to confirm it. Coins are credited only after the payment is confirmed as successful.',
      ],
    },
    {
      title: 'Earnings and redemption',
      paras: [
        'Creators may receive a share of the value of gifts they receive and other rewards that we make available. Rewards shown in the app are in virtual coins until they are successfully redeemed.',
      ],
      bullets: [
        'Redemption is optional, subject to the minimums, limits, fees and processing times shown in the app at the time of your request. Those details may change.',
        'You must confirm your identity, including by entering your account password, before a redemption request is accepted.',
        'You are responsible for providing correct payout details and for any taxes or duties on money you receive.',
        'We may delay, refuse or reverse a redemption if we suspect fraud, abuse, money laundering, a violation of these Terms, or if the law requires us to.',
        'Earnings that come from fraud, manipulation, fake accounts or self-gifting are not eligible and may be removed.',
      ],
    },
    {
      title: 'VIP and other paid features',
      paras: [
        'Some features may be offered as paid memberships or upgrades. The price, duration, benefits and any renewal settings are shown before you confirm. If a feature renews automatically, you can turn renewal off in the app before the next renewal date. Unless the law requires otherwise, fees already paid are not refunded for the unused part of a period.',
      ],
    },
    {
      title: 'Partner program',
      paras: [
        'The Partner program lets eligible users invite others and earn rewards connected to genuine activity in their network. It is a promotional program, not an employment, agency, franchise, investment or partnership in the legal sense.',
      ],
      bullets: [
        'You may join or leave the program through the app settings. Turning Partner status off may stop new connections from being created.',
        'Levels, qualification rules and reward rates are set by us, shown in the app, and may be changed, paused or ended with notice by an in-app message or update.',
        'Rewards depend on real, lawful activity by real people. You must not pay people to join, promise guaranteed income, run pyramid-style or misleading recruitment, or create fake accounts or fake activity.',
        'You must not make false or exaggerated claims about earnings. Results vary and are never guaranteed.',
        'We may withhold, reverse or cancel rewards and remove Partner status if we find abuse or a violation of these Terms.',
      ],
    },
    {
      title: 'Our rights and intellectual property',
      paras: [
        'The Service, including its design, software, brand, logo, graphics, animations, gifts, effects and all related content that we provide, is owned by Bee Took or our licensors and is protected by intellectual property laws. We give you a limited, personal, revocable, non-exclusive and non-transferable license to use the app for its intended purpose.',
        'You must not copy, modify, reverse engineer, decompile, scrape, resell or create derivative works from the Service, or use our name or logo, except as allowed by law or with our written permission.',
      ],
    },
    {
      title: 'Copyright and reporting',
      paras: [
        'We respect intellectual property. If you believe content on the Service infringes your rights, send a notice to ' + SUPPORT + ' with: your contact details; a description of the work; where the content appears in the app; a statement that you have a good-faith belief the use is unauthorized; and a statement, made in good faith, that your information is accurate and that you are the owner or authorized to act for the owner.',
        'We may remove content and restrict accounts of repeat infringers. You can also report videos, accounts, comments and live rooms directly in the app using the report options.',
      ],
    },
    {
      title: 'Moderation and enforcement',
      paras: [
        'We use a mix of automated tools, user reports and human review to keep the Service safe. If we believe you have broken these Terms or the law, or that your behavior puts others at risk, we may, at our discretion and with or without notice:',
      ],
      bullets: [
        'remove or limit the reach of content;',
        'warn, mute, or temporarily or permanently suspend features or your account;',
        'withhold or cancel rewards, and reverse transactions linked to the violation;',
        'report the matter to law enforcement or other authorities where appropriate.',
      ],
    },
    {
      title: 'Third-party links and services',
      paras: [
        'The Service may contain links to, or let you interact with, websites, content, payment methods and services that we do not own or control. We are not responsible for them, and your use of them is at your own risk and under their own terms.',
      ],
    },
    {
      title: 'Availability, updates and changes',
      paras: [
        'We work to keep the Service available but we do not promise it will be uninterrupted, error-free or free from loss of data. We may update, add, change or remove features at any time, and some updates may be required to keep using the Service. We may change these Terms from time to time. When we make a significant change, we will notify you in the app or by other reasonable means, and the new version applies from the date shown. If you continue to use the Service after that date, you accept the updated Terms. If you do not agree, you must stop using the Service.',
      ],
    },
    {
      title: 'Disclaimers',
      paras: [
        'To the maximum extent permitted by law, the Service is provided "as is" and "as available", without warranties of any kind, whether express or implied, including merchantability, fitness for a particular purpose, accuracy and non-infringement. We do not endorse, and are not responsible for, content posted by users or the opinions expressed in it. You use the Service at your own risk, and you are responsible for your own interactions with other people, including people you meet through the Service.',
      ],
    },
    {
      title: 'Limitation of liability',
      paras: [
        'To the maximum extent permitted by law, Bee Took, its owners, team members, partners and licensors will not be liable for any indirect, incidental, special, consequential, exemplary or punitive damages, or for any loss of profits, revenue, data, goodwill or virtual items, arising from or related to your use of, or inability to use, the Service.',
        'Our total liability for any claim relating to the Service is limited to the greater of (a) the amount you paid to us in the three months before the event that led to the claim, or (b) a nominal amount set by applicable law. Nothing in these Terms limits liability that cannot be limited by law, such as for fraud or for death or personal injury caused by negligence, where the law does not allow it.',
      ],
    },
    {
      title: 'Indemnity',
      paras: [
        'You agree to defend and hold harmless Bee Took and its team from claims, damages, losses and costs (including reasonable legal fees) arising from Your Content, your violation of these Terms or the law, or your violation of another person\'s rights.',
      ],
    },
    {
      title: 'Ending your use',
      paras: [
        'You can stop using the Service at any time and delete your account from Settings. We may suspend or end your access if you break these Terms, if the law requires it, or if we stop offering the Service. When an account is deleted, content and unspent coins linked to it may be permanently removed, and we may keep limited records where we need them for legal, safety, accounting or fraud-prevention reasons, as explained in the Privacy Policy. Sections that by their nature should continue (such as content licenses already granted for shared copies, payments owed, disclaimers, liability limits, indemnity and dispute resolution) will survive termination.',
      ],
    },
    {
      title: 'Governing law and disputes',
      paras: [
        'These Terms are governed by the laws of the Federal Democratic Republic of Ethiopia, without regard to conflict-of-law rules, and subject to any mandatory consumer protection laws of the place where you live.',
        'Please contact us first at ' + SUPPORT + ' so we can try to resolve any complaint informally. If we cannot, the dispute will be submitted to the competent courts of Addis Ababa, Ethiopia, unless the law that applies to you requires another forum. Where permitted, you and Bee Took each agree to bring claims only on an individual basis and not as part of a class or representative action.',
      ],
    },
    {
      title: 'General terms',
      bullets: [
        'Entire agreement: these Terms and the Privacy Policy are the complete agreement between you and us about the Service.',
        'Severability: if a part of these Terms is found unenforceable, the rest stays in force.',
        'No waiver: if we do not enforce a right right away, it does not mean we give it up.',
        'Assignment: you may not transfer your rights under these Terms. We may transfer ours as part of a reorganization, merger or sale.',
        'Language: these Terms are written in English. Translations are for convenience, and the English version prevails if they differ.',
      ],
    },
    {
      title: 'Contact us',
      paras: ['Questions about these Terms? Reach us at ' + SUPPORT + ' or through Profile, Menu, Help & support.'],
    },
  ],
};

const PRIVACY: LegalDoc = {
  title: 'Privacy Policy',
  tagline: 'What we collect, why we collect it, and the control you have over it.',
  updated: UPDATED,
  highlights: [
    'We collect only what we need to run Bee Took, keep it safe and improve it.',
    'We do not sell your personal information.',
    'You decide what the app can access on your device, such as camera, microphone and notifications.',
    'You can view and edit your profile, change your privacy settings and delete your account.',
    'We protect your data with technical and organizational safeguards.',
  ],
  intro: [
    'Your privacy matters to us. This Privacy Policy explains how Bee Took ("we", "us" or "our") collects, uses, shares and protects information about you when you use our mobile application and related features (the "Service"), and the choices you have.',
    'By ticking the agreement box, creating an account or using the Service, you confirm that you have read this Policy. If you do not agree with it, please do not use the Service.',
  ],
  sections: [
    {
      title: 'Information we collect',
      paras: ['We collect information in three ways: what you give us, what we collect automatically, and what comes from other people using the Service.'],
      bullets: [
        'Account details: name, username, phone number, email address, password (stored in protected form), profile photo, bio and the settings you choose.',
        'Your content: videos, photos, captions, comments, messages, sounds, live broadcasts, notes, and the likes, follows, shares and reports you make.',
        'Transaction details: coins you buy, gifts you send or receive, rewards, redemption requests, payout details you provide, and payment status. We do not store full card numbers; payments are handled by licensed payment processors and app stores.',
        'Partner program details: whether you take part, who you invited or who invited you, and activity needed to calculate levels and rewards.',
        'Device and usage information: device model, operating system, app version, language, time zone, network type, crash reports, performance data, and how you use features such as videos watched, searches and time spent.',
        'Identifiers and security signals: account and device identifiers, IP address, login history and verification events, used to protect accounts and prevent fraud.',
        'Support communications: messages you send to our support team and any details you include.',
      ],
    },
    {
      title: 'Device permissions',
      paras: ['The app asks for permission before it uses certain features of your device. You can change these at any time in your device settings, though some features will not work without them.'],
      bullets: [
        'Camera and microphone: to record videos, take photos, go live and join live rooms.',
        'Photos, media and storage: to choose content you want to upload and to save content you choose to download.',
        'Notifications: to tell you about likes, comments, follows, messages and live rooms.',
        'Network state: to adapt video quality and show connection status.',
      ],
    },
    {
      title: 'How we use information',
      bullets: [
        'To create and manage your account, verify your identity and keep you signed in securely.',
        'To provide the Service: show videos and live rooms, deliver messages, process gifts, coins, rewards and redemptions, and operate the Partner program.',
        'To personalize your experience, such as recommending videos and creators, and to adjust quality for your connection.',
        'To keep the community safe: detect spam, fraud, abuse and violations of our Terms, review reports, and protect minors.',
        'To communicate with you: send verification codes, security alerts, receipts, service updates and replies from support.',
        'To measure, test and improve the Service, fix bugs and develop new features.',
        'To comply with legal obligations, resolve disputes and enforce our agreements.',
      ],
    },
    {
      title: 'Our legal grounds',
      paras: ['Where the law requires us to have a legal ground to process personal information, we rely on one or more of the following:'],
      bullets: [
        'Contract: we need the information to provide the Service you asked for.',
        'Legitimate interests: for example, keeping the Service secure, preventing fraud and improving features, balanced against your rights.',
        'Consent: for example, when you allow device permissions or notifications. You can withdraw consent at any time.',
        'Legal obligation: where we must keep records or respond to lawful requests.',
      ],
    },
    {
      title: 'What other people can see',
      paras: [
        'Bee Took is a social service. Your public profile, username, profile photo, bio, public videos, comments, followers, likes and live rooms can be seen by other users, and in some cases by people who are not signed in. Messages are meant for the people you send them to. Gifts you send in live rooms may be visible to the host and other viewers.',
        'You can control who sees your videos and activity with privacy options in the app, such as private account and video visibility settings. Please think carefully before you post personal information in public areas.',
      ],
    },
    {
      title: 'How we share information',
      paras: ['We do not sell your personal information. We share it only in the following limited cases:'],
      bullets: [
        'With other users, as described above and according to your settings.',
        'With service providers who help us run the Service, such as hosting, storage, video delivery, messaging, email, payment processing, analytics and customer support. They may use the information only to provide services to us, under contractual commitments to protect it.',
        'With payment processors, app stores and banks, to complete purchases and payouts and to prevent fraud.',
        'For legal and safety reasons: to comply with law, court orders or valid government requests, to enforce our Terms, or to protect the rights, safety and property of users, the public or Bee Took.',
        'In a business change, such as a merger, acquisition, financing or sale of assets, where information may be transferred under the same protections.',
        'With your direction or consent, for example when you choose to share your profile or content outside the app.',
        'In aggregated or de-identified form that cannot reasonably identify you.',
      ],
    },
    {
      title: 'Data retention',
      paras: [
        'We keep information only as long as we need it for the purposes in this Policy. Account information and content are generally kept while your account is active. When you delete your account, we remove or de-identify your profile, content and unspent balances within a reasonable period, except for information we must keep for legal, accounting, safety or fraud-prevention reasons (for example, transaction records and records of serious violations), and copies that remain for a short time in secure backups.',
      ],
    },
    {
      title: 'Security',
      paras: [
        'We use technical and organizational measures designed to protect your information, including encrypted connections, access controls, optional two-step verification codes at login, protected password storage and monitoring for suspicious activity. No system is completely secure, so we cannot guarantee absolute security. Please use a strong, unique password, never share your verification codes, and tell us at ' + SUPPORT + ' if you suspect your account has been accessed without permission.',
      ],
    },
    {
      title: 'International transfers',
      paras: [
        'Bee Took and our service providers may process and store information in countries other than where you live. Those countries may have different data protection laws. Where we transfer information, we take steps to make sure it stays protected in line with this Policy and applicable law.',
      ],
    },
    {
      title: 'Your choices and rights',
      paras: ['Depending on where you live, you may have rights over your personal information. We provide these choices to everyone:'],
      bullets: [
        'Access and update: view and edit your profile and settings in the app.',
        'Delete: delete your account in Settings. Danger zone.',
        'Control visibility: use account and video privacy settings, block users and manage who can interact with you.',
        'Notifications: change notification choices in the app and in your device settings.',
        'Device permissions: turn camera, microphone, storage and notification permissions on or off in your device settings.',
        'Other rights: where the law allows, you may ask us to give you a copy of your information, correct it, restrict or object to certain processing, or withdraw consent. Contact ' + SUPPORT + ' and we will respond within a reasonable time and in line with the law. We may need to verify your identity first.',
        'Complaints: you may contact the data protection authority in your country if you believe your rights have been violated.',
      ],
    },
    {
      title: 'Children and teens',
      paras: [
        'Bee Took is not intended for children under 13 (or the higher minimum age in your country). We do not knowingly collect personal information from children below that age. If you believe a child has given us information, contact us and we will delete it. Users under 18 should use the Service with permission and guidance from a parent or guardian, and some features are limited or unavailable to them.',
      ],
    },
    {
      title: 'Cookies and similar technologies',
      paras: [
        'The app and our web pages may use local storage and similar technologies to keep you signed in, remember your preferences, improve speed (for example, by saving videos you choose to keep on your phone), keep the service secure and understand how features are used. You can clear local data in the app settings or in your device settings.',
      ],
    },
    {
      title: 'Third-party content and links',
      paras: [
        'The Service may link to or connect with services that we do not control. They have their own privacy practices, and we encourage you to read them before you share information with them.',
      ],
    },
    {
      title: 'Changes to this Policy',
      paras: [
        'We may update this Policy to reflect changes in the Service, our practices or the law. When we make a significant change, we will notify you in the app or by other reasonable means before it takes effect. The date at the top shows when it was last updated. Continued use of the Service after the update means you accept the updated Policy.',
      ],
    },
    {
      title: 'Contact us',
      paras: [
        'If you have questions, requests or concerns about privacy, contact us at ' + SUPPORT + ' or through Profile, Menu, Help & support. Bee Took is based in Addis Ababa, Ethiopia.',
      ],
    },
  ],
};

export const LEGAL: Record<LegalKind, LegalDoc> = { terms: TERMS, privacy: PRIVACY };
