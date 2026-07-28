-- CreateTable
CREATE TABLE "RequestCount" (
    "day" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RequestCount_pkey" PRIMARY KEY ("day")
);
