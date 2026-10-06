FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY knexfile.js ./
COPY catalog.json ./catalog.json
COPY warband-capacity.json ./warband-capacity.json
COPY equipment-catalog.json ./equipment-catalog.json
COPY trading-catalog.json ./trading-catalog.json
COPY promotion-eligible.json ./promotion-eligible.json
COPY skills-catalog.json ./skills-catalog.json
COPY skill-category-eligibility.json ./skill-category-eligibility.json
COPY hired-sword-skills.json ./hired-sword-skills.json
COPY spells-catalog.json ./spells-catalog.json
COPY spell-profile-access.json ./spell-profile-access.json
COPY migrations ./migrations
COPY src ./src
COPY test ./test
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
CMD ["npm", "start"]
