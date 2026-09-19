-- CreateTable
CREATE TABLE "Station" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Train" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trainType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Train_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainStop" (
    "id" SERIAL NOT NULL,
    "trainId" INTEGER NOT NULL,
    "stationId" INTEGER NOT NULL,
    "arrival" TEXT,
    "departure" TEXT,
    "haltMinutes" INTEGER,
    "day" INTEGER,
    "distanceKm" DOUBLE PRECISION,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "TrainStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilitySnapshot" (
    "id" SERIAL NOT NULL,
    "trainId" INTEGER NOT NULL,
    "sourceStation" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "journeyDate" TIMESTAMP(3) NOT NULL,
    "classCode" TEXT NOT NULL,
    "quotaCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "statusCode" TEXT NOT NULL,
    "availableSeats" INTEGER,
    "waitlistNumber" INTEGER,
    "waitlistType" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilitySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Station_code_key" ON "Station"("code");

-- CreateIndex
CREATE INDEX "Station_name_idx" ON "Station"("name");

-- CreateIndex
CREATE INDEX "Station_city_idx" ON "Station"("city");

-- CreateIndex
CREATE UNIQUE INDEX "Train_number_key" ON "Train"("number");

-- CreateIndex
CREATE INDEX "TrainStop_stationId_idx" ON "TrainStop"("stationId");

-- CreateIndex
CREATE INDEX "TrainStop_trainId_idx" ON "TrainStop"("trainId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainStop_trainId_sequence_key" ON "TrainStop"("trainId", "sequence");

-- CreateIndex
CREATE INDEX "AvailabilitySnapshot_trainId_journeyDate_idx" ON "AvailabilitySnapshot"("trainId", "journeyDate");

-- CreateIndex
CREATE INDEX "AvailabilitySnapshot_sourceStation_destination_journeyDate_idx" ON "AvailabilitySnapshot"("sourceStation", "destination", "journeyDate");

-- AddForeignKey
ALTER TABLE "TrainStop" ADD CONSTRAINT "TrainStop_trainId_fkey" FOREIGN KEY ("trainId") REFERENCES "Train"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainStop" ADD CONSTRAINT "TrainStop_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilitySnapshot" ADD CONSTRAINT "AvailabilitySnapshot_trainId_fkey" FOREIGN KEY ("trainId") REFERENCES "Train"("id") ON DELETE CASCADE ON UPDATE CASCADE;
