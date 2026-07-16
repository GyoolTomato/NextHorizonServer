require('dotenv').config();

const express = require('express');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const app = express();
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./dev.db' });
const prisma = new PrismaClient({ adapter });

const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET || 'dev-only-change-me';

app.use(express.json());

function signToken(userId) {
    return jwt.sign({ sub: userId }, jwtSecret, { expiresIn: '30d' });
}

async function authenticate(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'bearer token required' });
    }

    try {
        const payload = jwt.verify(token, jwtSecret);
        const user = await prisma.user.findUnique({
            where: { id: payload.sub },
        });

        if (!user) {
            return res.status(401).json({ error: 'invalid user' });
        }

        req.user = user;
        return next();
    } catch (error) {
        return res.status(401).json({ error: 'invalid token' });
    }
}

function toUserDto(user) {
    return {
        id: user.id,
        guestId: user.guestId,
        nickname: user.nickname,
        level: user.level,
    };
}

function pickWeighted(poolItems) {
    const totalWeight = poolItems.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.floor(Math.random() * totalWeight) + 1;

    for (const item of poolItems) {
        roll -= item.weight;
        if (roll <= 0) {
            return item;
        }
    }

    return poolItems[poolItems.length - 1];
}

async function seedCatalog() {
    const items = [
        { id: '1010001', type: 'PlayerExp', nameKey: 9040001, icon: 'x' },
        { id: '1010002', type: 'Gold', nameKey: 9040002, icon: 'x' },
        { id: '1010003', type: 'ExpCard', nameKey: 9040003, icon: 'x' },
    ];

    const characters = [
        {
            id: '1020001',
            name: 'Utc',
            nameKey: 1190001,
            model: 'Utc',
            rarity: 1,
            hp: 150,
            hpLevel: 2,
            atk: 15,
            atkLevel: 1,
            def: 2,
            defLevel: 1,
            avoid: 0.1,
            avoidLevel: 0.01,
            focus: 0.1,
            focusLevel: 0.01,
            atkspd: 10,
            atkspdLevel: 0,
            crirate: 0.2,
            crirateLevel: 0,
            cridmg: 0.5,
            cridmgLevel: 0,
            speed: 1.2,
            activeSkill: 1030001,
            passiveSkill0: 1030002,
            passiveSkill1: 1030003,
        },
        {
            id: '1020002',
            name: 'Misaki',
            nameKey: 1190002,
            model: 'Misaki',
            rarity: 2,
            hp: 140,
            hpLevel: 2,
            atk: 17,
            atkLevel: 1,
            def: 2,
            defLevel: 1,
            avoid: 0.1,
            avoidLevel: 0.01,
            focus: 0.1,
            focusLevel: 0.01,
            atkspd: 15,
            atkspdLevel: 0,
            crirate: 0.2,
            crirateLevel: 0,
            cridmg: 0.5,
            cridmgLevel: 0,
            speed: 1.3,
            activeSkill: 1030004,
            passiveSkill0: 1030005,
            passiveSkill1: 1030006,
        },
        {
            id: '1020003',
            name: 'Yuko',
            nameKey: 1190003,
            model: 'Yuko',
            rarity: 3,
            hp: 130,
            hpLevel: 2,
            atk: 20,
            atkLevel: 1,
            def: 1,
            defLevel: 1,
            avoid: 0.1,
            avoidLevel: 0.01,
            focus: 0.1,
            focusLevel: 0.01,
            atkspd: 20,
            atkspdLevel: 0,
            crirate: 0.3,
            crirateLevel: 0,
            cridmg: 0.5,
            cridmgLevel: 0,
            speed: 1.4,
            activeSkill: 1030007,
            passiveSkill0: 1030008,
            passiveSkill1: 1030009,
        },
    ];

    const missions = [
        { id: '1040001', titleKey: 9030001, reward0: '1010001', reward1: '1010002', reward2: '0' },
        { id: '1040002', titleKey: 9030002, reward0: '1010001', reward1: '1010003', reward2: '0' },
        { id: '1040003', titleKey: 9030003, reward0: '1010001', reward1: '0', reward2: '0' },
        { id: '1040004', titleKey: 9030004, reward0: '1010001', reward1: '1010002', reward2: '1010003' },
    ];

    const armors = [
        { id: '1050001', tier: 1, nameKey: 9030001, icon: '1010001', type: 'Shirt', value: 2 },
        { id: '1050002', tier: 1, nameKey: 9030002, icon: '1010001', type: 'Pants', value: 4 },
        { id: '1050003', tier: 1, nameKey: 9030003, icon: '1010001', type: 'Gloves', value: 6 },
        { id: '1050004', tier: 1, nameKey: 9030004, icon: '1010001', type: 'Shoes', value: 8 },
        { id: '1050005', tier: 2, nameKey: 9030003, icon: '1010001', type: 'Gloves', value: 10 },
        { id: '1050006', tier: 2, nameKey: 9030004, icon: '1010001', type: 'Shoes', value: 12 },
    ];

    const weapons = [
        { id: '1060001', tier: 1, nameKey: 9030001, icon: '1010001', value: 2 },
        { id: '1060002', tier: 1, nameKey: 9030002, icon: '1010001', value: 4 },
        { id: '1060003', tier: 2, nameKey: 9030003, icon: '1010001', value: 6 },
        { id: '1060004', tier: 2, nameKey: 9030004, icon: '1010001', value: 8 },
    ];

    for (const item of items) {
        await prisma.item.upsert({
            where: { id: item.id },
            update: item,
            create: item,
        });
    }

    for (const character of characters) {
        await prisma.character.upsert({
            where: { id: character.id },
            update: character,
            create: character,
        });
    }

    for (const mission of missions) {
        await prisma.mission.upsert({
            where: { id: mission.id },
            update: mission,
            create: mission,
        });
    }

    for (const armor of armors) {
        await prisma.armor.upsert({
            where: { id: armor.id },
            update: armor,
            create: armor,
        });
    }

    for (const weapon of weapons) {
        await prisma.weapon.upsert({
            where: { id: weapon.id },
            update: weapon,
            create: weapon,
        });
    }

    await prisma.gachaBanner.upsert({
        where: { id: 'standard' },
        update: {
            name: 'Standard Banner',
            costType: '1010002',
            singleCost: 100,
            isActive: true,
        },
        create: {
            id: 'standard',
            name: 'Standard Banner',
            costType: '1010002',
            singleCost: 100,
            isActive: true,
        },
    });

    const pool = [
        { characterId: '1020001', weight: 6000 },
        { characterId: '1020002', weight: 3000 },
        { characterId: '1020003', weight: 1000 },
    ];

    for (const item of pool) {
        await prisma.gachaPoolItem.upsert({
            where: {
                bannerId_characterId: {
                    bannerId: 'standard',
                    characterId: item.characterId,
                },
            },
            update: { weight: item.weight },
            create: {
                bannerId: 'standard',
                characterId: item.characterId,
                weight: item.weight,
            },
        });
    }
}

app.get('/health', (req, res) => {
    return res.json({ ok: true });
});

app.post('/auth/guest', async (req, res, next) => {
    try {
        const guestId = req.body.guestId || randomUUID();
        const nickname = req.body.nickname || 'NewUser';

        const user = await prisma.user.upsert({
            where: { guestId },
            update: { nickname },
            create: { guestId, nickname },
        });

        return res.json({
            token: signToken(user.id),
            user: toUserDto(user),
        });
    } catch (error) {
        return next(error);
    }
});

app.get('/me', authenticate, (req, res) => {
    return res.json({ user: toUserDto(req.user) });
});

app.get('/inventory', authenticate, async (req, res, next) => {
    try {
        const characters = await prisma.playerCharacter.findMany({
            where: { userId: req.user.id },
            include: { character: true },
            orderBy: [
                { character: { rarity: 'desc' } },
                { acquiredAt: 'asc' },
            ],
        });
        const items = await prisma.playerItem.findMany({
            where: { userId: req.user.id },
            include: { item: true },
            orderBy: { acquiredAt: 'asc' },
        });
        const armors = await prisma.playerArmor.findMany({
            where: { userId: req.user.id },
            include: { armor: true },
            orderBy: { acquiredAt: 'asc' },
        });
        const weapons = await prisma.playerWeapon.findMany({
            where: { userId: req.user.id },
            include: { weapon: true },
            orderBy: { acquiredAt: 'asc' },
        });

        return res.json({
            characters: characters.map((item) => ({
                characterId: item.characterId,
                name: item.character.name,
                rarity: item.character.rarity,
                quantity: item.quantity,
            })),
            items: items.map((entry) => ({
                itemId: entry.itemId,
                type: entry.item.type,
                nameKey: entry.item.nameKey,
                icon: entry.item.icon,
                quantity: entry.quantity,
            })),
            armors: armors.map((entry) => ({
                armorId: entry.armorId,
                tier: entry.armor.tier,
                nameKey: entry.armor.nameKey,
                icon: entry.armor.icon,
                type: entry.armor.type,
                value: entry.armor.value,
                quantity: entry.quantity,
            })),
            weapons: weapons.map((entry) => ({
                weaponId: entry.weaponId,
                tier: entry.weapon.tier,
                nameKey: entry.weapon.nameKey,
                icon: entry.weapon.icon,
                value: entry.weapon.value,
                quantity: entry.quantity,
            })),
        });
    } catch (error) {
        return next(error);
    }
});

app.get('/gacha/banners', async (req, res, next) => {
    try {
        const banners = await prisma.gachaBanner.findMany({
            where: { isActive: true },
            include: {
                poolItems: {
                    include: { character: true },
                    orderBy: { weight: 'desc' },
                },
            },
        });

        return res.json({
            banners: banners.map((banner) => ({
                id: banner.id,
                name: banner.name,
                costType: banner.costType,
                singleCost: banner.singleCost,
                pool: banner.poolItems.map((item) => ({
                    characterId: item.characterId,
                    name: item.character.name,
                    rarity: item.character.rarity,
                    weight: item.weight,
                })),
            })),
        });
    } catch (error) {
        return next(error);
    }
});

app.post('/gacha/pull', authenticate, async (req, res, next) => {
    try {
        const bannerId = req.body.bannerId || 'standard';
        const count = Number(req.body.count || 1);

        if (![1, 10].includes(count)) {
            return res.status(400).json({ error: 'count must be 1 or 10' });
        }

        const result = await prisma.$transaction(async (tx) => {
            const banner = await tx.gachaBanner.findFirst({
                where: { id: bannerId, isActive: true },
                include: {
                    poolItems: {
                        include: { character: true },
                    },
                },
            });

            if (!banner || banner.poolItems.length === 0) {
                const error = new Error('active banner not found');
                error.status = 404;
                throw error;
            }

            const rewards = [];

            for (let i = 0; i < count; i++) {
                const selected = pickWeighted(banner.poolItems);

                await tx.playerCharacter.upsert({
                    where: {
                        userId_characterId: {
                            userId: req.user.id,
                            characterId: selected.characterId,
                        },
                    },
                    update: { quantity: { increment: 1 } },
                    create: {
                        userId: req.user.id,
                        characterId: selected.characterId,
                        quantity: 1,
                    },
                });

                await tx.gachaHistory.create({
                    data: {
                        userId: req.user.id,
                        bannerId: banner.id,
                        characterId: selected.characterId,
                        pullCount: 1,
                        costType: banner.costType,
                        costAmount: banner.singleCost,
                    },
                });

                rewards.push({
                    characterId: selected.characterId,
                    name: selected.character.name,
                    rarity: selected.character.rarity,
                });
            }

            return {
                bannerId: banner.id,
                costType: banner.costType,
                costAmount: banner.singleCost * count,
                rewards,
            };
        });

        return res.json(result);
    } catch (error) {
        return next(error);
    }
});

// Legacy compatibility for the previous Unity prototype endpoint.
app.get('/user', async (req, res, next) => {
    try {
        const guestId = req.query.uid;

        if (!guestId) {
            return res.status(400).json({ error: 'uid required' });
        }

        const user = await prisma.user.upsert({
            where: { guestId },
            update: {},
            create: { guestId },
        });

        return res.json(toUserDto(user));
    } catch (error) {
        return next(error);
    }
});

app.use((error, req, res, next) => {
    if (!error.status || error.status >= 500) {
        console.error(error);
    }

    return res.status(error.status || 500).json({
        error: error.message || 'internal server error',
    });
});

seedCatalog()
    .then(() => {
        app.listen(port, '0.0.0.0', () => {
            console.log(`server running on port ${port}`);
        });
    })
    .catch((error) => {
        console.error('failed to start server', error);
        process.exit(1);
    });
